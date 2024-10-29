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
const {
  initializeDatabase,
  insertIntoRobotURL,
  insertIntoURLDescription,
  insertIntoURLKeyword,
  retrieveRobotURLByPos,
  retrieveRobotURLCount,
  searchURLAndRankByKeywords,
} = require("./mySQLHelpers.js"); // Import the mySQLHelpers module
const { type } = require("os");

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

// Initialize the database and create the tables
// If there is an error, log it and exit the process with an error code

//Async context to allow for await.
(async () => {
  // Initialize the database and create the tables
  // If there is an error, log it and exit the process with an error code
  if (!(await initializeDatabase(MAX_DESCRIPTION_LENGTH))) {
    console.log("Error initializing database");
    process.exit(1);
  }

  // Succeeded in initializing the database and creating the tables
  // Insert the starting URLs into the database
  for (let i = 0; i < STARTING_URLS.length; i++) {
    await insertIntoRobotURL(STARTING_URLS[i]);
  }

  // Create the bots

  // Create the server
  http
    .createServer(function (req, res) {
      // Set CORS headers
      res.setHeader("Access-Control-Allow-Origin", "https://zpcosc631.com"); // Specify your domain
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      // Handle OPTIONS preflight request
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Parse the request URL
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;

      // Log the request method and pathname
      console.log(`Received ${req.method} request for ${pathname}`);

      if (pathname === "/" && req.method === "POST") {
        let body = "";

        // Accumulate incoming data
        req.on("data", function (chunk) {
          body += chunk;
        });

        // Handle the complete request
        req.on("end", async function () {
          try {
            // debounce requests if the database is being built
            if (buildingDatabase) {
              console.log("Database is being built, please wait.");
              res.writeHead(503, { "Content-Type": "text/plain" });
              res.end("Database is being built, please wait.");
              return;
            }

            // If we're here, the database is built and we can proceed
            // Parse the incoming JSON data
            const dataObj = JSON.parse(body);
            let keywords = dataObj.keywords;
            let searchType = dataObj.searchType;

            // If keywords is a string, split it into an array of keywords, trim whitespace, and convert to lowercase for standardization
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

            // Log the incoming request and data
            console.log("Incoming POST request for /");
            console.log(`keywords: ${keywords} searchType: ${searchType}`);

            // if keywords or searchType are not provided, return an error
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

            // if keyWords is empty, return an error
            if (!Array.isArray(keywords) || keywords.length === 0) {
              console.log("No keywords provided in the request body.");
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end("Keywords are required in the request body");
              return;
            }

            // if searchType is not 'or' or 'and', return an error
            if (searchType !== "or" && searchType !== "and") {
              console.log("Invalid searchType provided in the request body.");
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end("SearchType must be 'or' or 'and'");
              return;
            }

            // Perform the search
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
        // Handle other routes or methods
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    })
    .listen(PORT, "127.0.0.1", () => {
      console.log(`Server running at http://zp-cosc631.com:${PORT}/`);
    });
})();
