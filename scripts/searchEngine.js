/* 
Purpose: Create a Node.js server to handle incoming POST and GET requests for a search engine.
 The server here is largely repurposed from the previous assignment.
 Key differences:
 -The server employs bots via worker threads to fetch data from URLs and parse the HTML content.
 -SQL has been offloaded to a separate file for better organization.
*/

// Import required modules
const http = require("http");
const axios = require("axios");
const url = require("url"); // Import the url module
const { Worker } = require("worker_threads"); // Import worker_threads for creating bots
const {
  initializeDatabase,
  insertIntoRobotURL,
  insertIntoURLDescription,
  insertIntoURLKeyword,
  retrieveRobotURLByPos,
  retrieveRobotURLCount,
  searchURLAndRankByKeywords,
} = require("./mySQLHelpers.js"); // Import the mySQLHelpers module

const PORT = 8082; // Specify the port for the server for Assignment 3: Search Engine

// Constants for the search engine, database, and bots
const K = 10;
const N = 500;
const MAX_DESCRIPTION_LENGTH = 200;
const STARTING_URLS = [
  "https://www.emich.edu",
  "https://annarbornews.com",
  "https://www.whitehouse.gov",
];

let buildingDatabase = true; // Flag to indicate if the database is being built, bounce requests if true
let bots = []; // Array to store the bots
let position = 1; // Position to start fetching URLs from the database via the bots

// Function to create and start a bot
function createBot(url) {
  const bot = new Worker("./worker.js", {
    workerData: {
      url,
      keyWordLimit: K,
      descriptionLength: MAX_DESCRIPTION_LENGTH,
      halt: false,
    },
  });

  bot.on("message", (message) => {
    if (message.request === "getNextURL") {
      // Handle request for next URL from bot
      if (position <= N) {
        //This if will cut us off at exploring 500 URLs
        retrieveRobotURLByPos(position)
          .then((newURL) => {
            if (newURL) {
              bot.postMessage({ request: "newURL", url: newURL });
              position++;
            } else {
              console.log("No more URLs available for the bot to process.");
              bot.postMessage({ request: "halt" });
            }
          })
          .catch((err) => {
            console.error("Error retrieving next URL:", err.message);
            bot.postMessage({ request: "halt" });
          });
      } else {
        console.log("No more URLs available for the bot to process.");
        bot.postMessage({ request: "halt" });
      }
    } else if (message.request === "storeRobotURLs") {
      // Handle storing of URLs found by the bot
      message.urls.forEach((url) => {
        insertIntoRobotURL(url).catch((err) =>
          console.error("Error inserting URL into database:", err.message)
        );
      });
    } else if (message.request === "storeTags") {
      // Handle storing of parsed tags
      message.tags.forEach((tag, index) => {
        insertIntoURLKeyword(message.url, tag, message.ranks[index]).catch(
          (err) =>
            console.error("Error inserting keyword into database:", err.message)
        );
      });
    } else if (message.request === "storeDescription") {
      // Handle storing of description
      insertIntoURLDescription(message.url, message.description).catch((err) =>
        console.error("Error inserting description into database:", err.message)
      );
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

// Initialize the database and create the tables
(async () => {
  if (!(await initializeDatabase(MAX_DESCRIPTION_LENGTH))) {
    console.log("Error initializing database");
    process.exit(1);
  }

  // Insert the starting URLs into the database
  for (let i = 0; i < STARTING_URLS.length; i++) {
    await insertIntoRobotURL(STARTING_URLS[i]);
  }

  // Create the initial bot (only 1 for now for testing.)
  createBot(STARTING_URLS[0]);
  bots.forEach((bot) => bot.postMessage({ request: "start" }));

  buildingDatabase = true;

  // Create the server
  http
    .createServer(function (req, res) {
      res.setHeader("Access-Control-Allow-Origin", "https://zpcosc631.com");
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
      console.log(`Server running at http://zp-cosc631.com:${PORT}/`);
    });
})();
