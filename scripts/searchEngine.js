// searchEngine.js

const http = require("http");
const url = require("url");
const { Worker } = require("worker_threads");
const {
  initializeDatabase,
  insertIntoRobotURL,
  retrieveDescriptionURLCount,
  searchURLAndRankByKeywords,
  searchPositionsByKeyword,
  searchDescriptionByURL,
} = require("./mySQLHelpers.js");

const PORT = 8082;
const K = 5;
const N = 250;
const MAX_DESCRIPTION_LENGTH = 200;
const STARTING_URLS = [
  "https://www.whitehouse.gov",
  "http://www.wayne.edu",
  "http://www.cnn.com",
];

let buildingDatabase = true;
let bots = [];
let phraseResults = [];
let position = 1;
let additional = 0;

function createBot() {
  const bot = new Worker("./worker.js", {
    workerData: { K: K, DESCRIPTION_LENGTH: MAX_DESCRIPTION_LENGTH },
  });

  console.log("Bot created and requesting initial position.");

  bot.on("message", (message) => {
    console.log("Main thread received message from bot:", message);

    if (message.request === "getNextPos") {
      console.log(
        `Received getNextPos message from bot, success status: ${message.success}`
      );
      if (!buildingDatabase) return;

      if (!message.success) {
        console.log(
          "Worker thread failed to process URL, adding additional URL to process."
        );
        additional++;
      }

      if (position <= N + additional) {
        console.log(`Sending position ${position} to bot`);
        bot.postMessage({ pos: position });
        position++;
      } else {
        retrieveDescriptionURLCount().then((count) => {
          if (count < N) {
            console.log(
              "Not enough URLs processed, adding more URLs to process."
            );
            additional += N - count;
            bot.postMessage({ pos: position });
            position++;
          } else {
            console.log("Database building complete. Signaling bot to stop.");
            bot.postMessage({ pos: null });
            buildingDatabase = false;
          }
        });
      }
    }

    if (message.request === "searchResult") {
      console.log("Received search result from bot:", message.result);
      phraseResults.push(message.result);
    }
  });

  bot.on("error", (err) => {
    console.error("Worker thread error:", err.message);
  });

  bot.on("exit", (code) => {
    if (code !== 0) {
      console.error(`Worker stopped with exit code ${code}`);
    } else {
      console.log("Worker exited gracefully.");
    }
  });

  bots.push(bot);
  console.log("Sending initial getNextPos request to bot");
  bot.postMessage({ request: "getNextPos" });
}

// Initialize the database and create the bots
(async () => {
  if (!(await initializeDatabase(MAX_DESCRIPTION_LENGTH))) {
    console.log("Error initializing database");
    process.exit(1);
  }

  for (let i = 0; i < STARTING_URLS.length; i++) {
    await insertIntoRobotURL(STARTING_URLS[i]);
  }

  const BOT_COUNT = 3;
  for (let i = 0; i < BOT_COUNT; i++) {
    createBot();
  }

  buildingDatabase = true;

  http
    .createServer(function (req, res) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;

      console.log(`Received ${req.method} request for ${pathname}`);

      if (pathname === "/" && req.method === "POST") {
        let body = "";

        req.on("data", (chunk) => {
          body += chunk;
        });

        req.on("end", async () => {
          try {
            if (buildingDatabase) {
              res.writeHead(503, { "Content-Type": "text/plain" });
              res.end("Initial database state is being built, please wait.");
              return;
            }

            const dataObj = JSON.parse(body);
            let keywords = dataObj.keywords;
            let searchType = dataObj.searchType;

            if (typeof keywords === "string") {
              keywords = keywords
                .split(",")
                .map((k) => k.trim().toLowerCase())
                .filter(Boolean);
            } else if (Array.isArray(keywords)) {
              keywords = keywords
                .map((k) => k.trim().toLowerCase())
                .filter(Boolean);
            }

            console.log(
              `Incoming POST request for / with keywords: ${keywords}, searchType: ${searchType}`
            );

            if (!keywords || !searchType) {
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end(
                "Keywords and searchType are required in the request body"
              );
              return;
            }

            if (searchType !== "or" && searchType !== "and") {
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end("SearchType must be 'or' or 'and'");
              return;
            }

            let phrases = [];
            let words = [];
            const phraseRegex = /^".*"$/;
            keywords.forEach((keyword) => {
              if (phraseRegex.test(keyword)) {
                phrases.push(keyword.slice(1, -1));
              } else {
                words.push(keyword);
              }
            });

            if (phrases.length > 0 && words.length === 0) {
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end("Phrases must be associated with at least one keyword.");
              return;
            }

            if (phrases.length > 0) {
              await searchPositionsByKeyword(words[0]).then(
                async (positions) => {
                  if (positions.length === 0) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify([]));
                    return;
                  } else {
                    await phraseSearch(
                      phrases,
                      positions,
                      searchType == "or"
                    ).then(async () => {
                      let formattedResults = [];

                      const urls = phraseResults.map((result) => result.url);
                      const descriptions = await searchDescriptionByURL(urls);

                      formattedResults = phraseResults.map((result) => {
                        const description =
                          descriptions.find((desc) => desc.url === result.url)
                            ?.description || "";
                        return {
                          url: result.url,
                          description: description,
                          rank: result.rank,
                        };
                      });

                      res.writeHead(200, {
                        "Content-Type": "application/json",
                      });
                      res.end(JSON.stringify(formattedResults));
                    });
                  }
                }
              );
            } else {
              await searchURLAndRankByKeywords(keywords, searchType === "or")
                .then((results) => {
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end(JSON.stringify(results));
                })
                .catch((err) => {
                  res.writeHead(500, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ error: "Error performing search" }));
                });
            }
          } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON in request body" }));
          }
        });
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    })
    .listen(PORT, "127.0.0.1", () => {
      console.log(`Server running at http://127.0.0.1:${PORT}/`);
    });
})();

const phraseSearch = async (phrases, positions, OR = true) => {
  bots = [];
  const botPromises = positions.map((pos) => {
    return new Promise((resolve, reject) => {
      const bot = new Worker("./worker.js", {
        workerData: { K: K, DESCRIPTION_LENGTH: MAX_DESCRIPTION_LENGTH },
      });

      bot.on("message", (message) => {
        if (message.request === "searchResult") {
          phraseResults.push(message.result);
          resolve();
        }
      });

      bot.on("error", (err) => {
        console.error("Worker thread error:", err.message);
        reject(err);
      });

      bot.on("exit", (code) => {
        if (code !== 0) {
          console.error(`Worker stopped with exit code ${code}`);
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });

      bot.postMessage({
        request: "phraseSearch",
        phrases: phrases,
        pos: pos,
        or: OR,
      });

      bots.push(bot);
    });
  });

  await Promise.all(botPromises);
};
