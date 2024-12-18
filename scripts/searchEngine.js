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
let position = 1; // Position to start fetching URLs from the database via the bots
let additional = 0; // Additional URLs to fetch

// Function to create and start a bot
function createBot() {
  const bot = new Worker("./worker.js", {
    workerData: { K: K, DESCRIPTION_LENGTH: MAX_DESCRIPTION_LENGTH },
  });
  bot.on("message", (message) => {
    if (message.request === "getNextPos") {
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
              res.end("Database is being built, please wait.");
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
