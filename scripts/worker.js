// worker.js

const { parentPort } = require("worker_threads");
const axios = require("axios");
const cheerio = require("cheerio"); // Library to parse HTML data
const {
  initializeConnection,
  retrieveRobotURLByPos,
  insertIntoRobotURL,
  insertIntoURLDescription,
  insertIntoURLKeyword,
} = require("./mySQLHelpers.js"); // Import database helper functions

const keyWordLimit = 10; // Set your desired keyword limit (K)
const descriptionLength = 200; // Maximum length of the description to store in the database
let halt = false; // A flag to stop the worker from processing more URLs

// Function to request the next position from the parent process
function requestNextPosFromParent() {
  parentPort.postMessage({ request: "getNextPos" });
}

// Function to fetch page data using axios
async function retrievePageData(url) {
  try {
    const response = await axios.get(url, { timeout: 5000 });
    return response.data;
  } catch (error) {
    console.error(`Error fetching data from ${url}:`, error.message);
    return null;
  }
}

// Function to remove URL fragment
function removeURLFragment(url) {
  return url.split("#")[0];
}

// Function to transform relative URLs to absolute URLs
function transformRelativeURL(url, baseURL) {
  if (url.startsWith("http")) return url;
  return new URL(url, baseURL).href;
}

// Function to find URLs in HTML
function findURLsInHTML($, currentURL) {
  let urls = [];
  $("a[href]").each((_, element) => {
    let url = $(element).attr("href");
    if (url)
      urls.push(transformRelativeURL(removeURLFragment(url), currentURL));
  });
  return urls;
}

// Function to find keywords in HTML
function findKeyWordsInHTML($) {
  let tags = [];
  const metaTags = $('meta[name="keywords"]').attr("content");
  if (metaTags) {
    tags = metaTags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 3);
    if (tags.length >= keyWordLimit) return tags.slice(0, keyWordLimit);
  }

  let targetTags = ["title", "h1", "h2", "h3", "h4", "h5", "h6"];
  for (let tag of targetTags) {
    let tempTags = getKeywordsFromTargetTag(tag, $);
    tags = tags.concat(tempTags);
    if (tags.length >= keyWordLimit) {
      tags = tags.slice(0, keyWordLimit);
      break;
    }
  }
  return tags;
}

// Helper function to get keywords from target tags
function getKeywordsFromTargetTag(tag, $) {
  const text = $(tag).text();
  if (text) {
    return text
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3);
  }
  return [];
}

// Function to find rankings of keywords
function findRankings(keyWordList, $) {
  let rankings = [];
  let cleanedData = $.root().text();

  keyWordList.forEach((keyWord) => {
    let regex = new RegExp(`\\b${escapeRegExp(keyWord)}\\b`, "gi");
    let matches = cleanedData.match(regex);
    let count = matches ? matches.length : 0;
    rankings.push(count + findRankingsInMetaTags(keyWord, $));
  });
  return rankings;
}

// Helper function to find rankings in meta tags
function findRankingsInMetaTags(keyword, $) {
  let metaTags = $('meta[name="keywords"]').attr("content");
  if (metaTags) {
    let regex = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "gi");
    let matches = metaTags.match(regex);
    return matches ? matches.length : 0;
  }
  return 0;
}

// Function to build a description from the HTML content
function buildDescription($, length) {
  let description = $('meta[name="description"]').attr("content");
  if (description && description.length > length) {
    return description.slice(0, length);
  }

  let targetTags = ["title", "h1", "h2", "h3", "h4", "h5", "h6"];
  description = "";

  for (let tag of targetTags) {
    let tempDescription = $(tag).text().trim();
    if (tempDescription.length > 0) {
      description += (description.length > 0 ? " " : "") + tempDescription;
      if (description.length >= length) {
        description = description.slice(0, length);
        break;
      }
    }
  }
  return description;
}

// Helper function to escape special characters in regex
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Main function to process URL by position
async function processURLByPos(pos) {
  const url = await retrieveRobotURLByPos(pos);
  if (!url) {
    console.warn(`No URL found at position ${pos}`);
    requestNextPosFromParent();
    return;
  }

  const currentURL = url;
  console.log(`Bot processing URL at position ${pos}: ${currentURL}`);

  let htmlData = await retrievePageData(currentURL);
  if (htmlData && typeof htmlData === "string") {
    const $ = cheerio.load(htmlData);

    // Find and insert new URLs into robotURL
    let urlList = findURLsInHTML($, currentURL);
    for (const newURL of urlList) {
      await insertIntoRobotURL(newURL);
    }

    // Find keywords and their rankings
    let keyWordList = findKeyWordsInHTML($);
    if (keyWordList.length > 0 && !halt) {
      let rankings = findRankings(keyWordList, $);

      // Insert keywords and rankings into urlKeyword
      await insertIntoURLKeyword(currentURL, keyWordList, rankings);

      // Build and insert description into urlDescription
      let description = buildDescription($, descriptionLength);
      await insertIntoURLDescription(currentURL, description);
    } else {
      console.log(`No keywords found for URL: ${currentURL}`);
    }
  } else {
    console.log(`Failed to retrieve or parse HTML for URL: ${currentURL}`);
  }
  requestNextPosFromParent();
}

// Message handling from parent process
parentPort.on("message", async (message) => {
  if (message.pos !== undefined) {
    if (message.pos !== null) {
      const pos = message.pos;
      await processURLByPos(pos);
    } else {
      console.log("No more URLs to process. Bot is exiting.");
      process.exit(0);
    }
  } else if (message.request === "halt") {
    halt = true;
    console.log("Bot received halt request.");
  }
});

// Start processing by requesting the first position
requestNextPosFromParent();
