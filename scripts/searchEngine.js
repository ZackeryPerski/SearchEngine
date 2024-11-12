// searchEngine.js

/* 
Purpose: Create a Node.js server to handle incoming POST and GET requests for a search engine.
The server employs bots via worker threads to fetch data from URLs and parse the HTML content.
SQL operations are offloaded to a separate file for better organization.
*/

// Import required modules
const http = require("http");
const url = require("url"); // Import the url module
const { Worker } = require("worker_threads"); // Import worker_threads for creating bots
const {
  initializeDatabase,
  insertIntoRobotURL,
  retrieveDescriptionURLCount,
  searchURLAndRankByKeywords,
  searchPositionsByKeyword,
} = require("./mySQLHelpers.js"); // Import the mySQLHelpers module

const PORT = 8082; // Specify the port for the server

// Constants for the search engine, database, and bots
const K = 5; // Keyword limit
const N = 250; // Maximum number of URLs to process
const MAX_DESCRIPTION_LENGTH = 200; // Maximum description length
const STARTING_URLS = [
  "https://www.whitehouse.gov",
  "http://www.wayne.edu",
  "http://www.cnn.com",
];

let buildingDatabase = true; // Flag to indicate if the database is being built
let bots = []; // Array to store the bots
let phraseResults = []; // Array to store the results of phrase searches
let position = 1; // Position to start fetching URLs from the database via the bots
let additional = 0; // Additional URLs to fetch

// Function to create and start a bot
function createBot() {
  const bot = new Worker("./worker.js", {
    workerData: { K: K, DESCRIPTION_LENGTH: MAX_DESCRIPTION_LENGTH },
  });
  bot.on("message", (message) => {
    if (message.request === "getNextPos") {
      if (!buildingDatabase) {
        // Database building is complete, ignore the request, as bots will be created to handle the search requests.
        // These bots automatically request the next position to process on initialization, so we don't need to handle this request.
        return;
      }
      if (!message.success) {
        console.log(
          "Worker thread failed to process URL, adding additional URL to process."
        );
        additional++;
      }
      if (position <= N + additional) {
        bot.postMessage({ pos: position });
        position++;
      } else {
        //getting near the end of the data processing, need to ensure that we've stored N keywordURL entries.
        retrieveDescriptionURLCount().then((count) => {
          if (count < N) {
            console.log(
              "Not enough URLs processed, adding more URLs to process."
            );
            additional += N - count;
            bot.postMessage({ pos: position });
            position++;
          } else {
            bot.postMessage({ pos: null }); // Signal no more positions
            buildingDatabase = false; // Database building is complete
          }
        });
      }
    }
    // No need to handle storage requests as bots handle storage directly
    if (message.request === "searchResult") {
      console.log("Search result for phrase search:");
      console.log(message.result);
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

  bots.push(bot); // Add the bot to the bots array
}

// Initialize the database and create the bots
(async () => {
  if (!(await initializeDatabase(MAX_DESCRIPTION_LENGTH))) {
    console.log("Error initializing database");
    process.exit(1);
  }

  // Insert the starting URLs into the database
  for (let i = 0; i < STARTING_URLS.length; i++) {
    await insertIntoRobotURL(STARTING_URLS[i]);
  }

  // Create and start bots
  const BOT_COUNT = 1; // Multiple bots are unsafe atm, they go too fast.
  for (let i = 0; i < BOT_COUNT; i++) {
    createBot();
  }
  // Bots will request positions upon starting
  bots.forEach((bot) => bot.postMessage({ request: "getNextPos" }));

  buildingDatabase = true;

  // Create the server
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
              console.log("Database is being built, please wait.");
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
                .map((keyword) => keyword.trim().toLowerCase())
                .filter(Boolean);
            } else if (Array.isArray(keywords)) {
              keywords = keywords
                .map((keyword) => keyword.trim().toLowerCase())
                .filter(Boolean);
            }

            console.log("Incoming POST request for /");
            console.log(`keywords: ${keywords} searchType: ${searchType}`);

            if (!keywords || !searchType) {
              console.log(
                "Keywords or searchType not provided in the request body."
              );
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end(
                "Keywords and searchType are required in the request body"
              );
              return;
            }

            if (!Array.isArray(keywords) || keywords.length === 0) {
              console.log("No keywords provided in the request body.");
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end("Keywords are required in the request body");
              return;
            }

            if (searchType !== "or" && searchType !== "and") {
              console.log("Invalid searchType provided in the request body.");
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end("SearchType must be 'or' or 'and'");
              return;
            }

            //split the keywords into two arrays, one for "phrases" and one for keywords.
            //"phrases" should be searched for as a whole, in addition, they trigger a dynamic search based on urls that contain the phrase.
            //If there are no "phrases", then the search is a simple search for the keywords already in the database.
            let phrases = [];
            let words = [];
            const phraseRegex = /^".*"$/;
            keywords.forEach((keyword) => {
              if (phraseRegex.test(keyword)) {
                phrases.push(keyword.slice(1, -1)); // Remove the surrounding quotes
              } else {
                words.push(keyword);
              }
            });

            // Phrase searches need to have at least one keyword associated with them.
            if (phrases.length > 0 && words.length === 0) {
              console.log(
                "Phrases must be associated with at least one keyword."
              );
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end(
                "Phrases must be associated with at least one keyword. Only the first keyword will be used."
              );
              return;
            }

            // If there are phrases, we need to search for URLs that contain the phrases
            if (phrases.length > 0) {
              // Perform initial search of the database for URLs that contain the keywords
              // The purpose of this search is to ensure that all potential URLs that contain the keywords are processed in the database before the search
              // This is to ensure that the search results are as accurate as possible.
              await searchPositionsByKeyword(words[0]).then(
                async (positions) => {
                  if (positions.length === 0) {
                    console.log("No URLs found containing the keywords.");
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify([]));
                    return;
                  } else {
                    console.log(
                      "Additional URLs found containing the keyword."
                    );
                    console.log(positions);
                    await phraseSearch(phrases, positions).then(() => {
                      console.log("Phrase search results:");
                      console.log(phraseResults);
                      res.writeHead(200, {
                        "Content-Type": "application/json",
                      });
                      res.end(JSON.stringify(phraseResults));
                    });
                  }
                }
              );
              // If there are no phrases, we can perform a simple search for the keywords in the database
            } else {
              //--This is the original search code, it is not used if there are phrases to search for.--//
              // Perform search of the database for URLs that contain the keywords and rank them
              await searchURLAndRankByKeywords(keywords, searchType === "or")
                .then((results) => {
                  console.log("Search results:");
                  console.log(results);
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end(JSON.stringify(results));
                })
                .catch((err) => {
                  console.error("Error performing search:", err.message);
                  res.writeHead(500, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ error: "Error performing search" }));
                });
            }
          } catch (err) {
            console.error("Error parsing JSON:", err.message);
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

// additional helper functions
const phraseSearch = async (phrases, positions) => {
  bots = []; // Clear the bots array
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
      });

      bots.push(bot);
    });
  });

  await Promise.all(botPromises);
};
