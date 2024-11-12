// worker.js

const { parentPort, workerData } = require("worker_threads");
const { chromium } = require("playwright");
const cheerio = require("cheerio"); // Library to parse HTML data
const {
  initializeConnection,
  retrieveRobotURLByPos,
  insertIntoRobotURL,
  insertIntoURLDescription,
  insertIntoURLKeyword,
} = require("./mySQLHelpers.js"); // Import database helper functions

const keyWordLimit = workerData.K; // Set your desired keyword limit (K)
const descriptionLength = workerData.DESCRIPTION_LENGTH; // Maximum length of the description to store in the database
let halt = false; // A flag to stop the worker from processing more URLs

// Function to request the next position from the parent process
function requestNextPosFromParent(success = true) {
  parentPort.postMessage({ request: "getNextPos", success });
}

// Function to fetch HTML with Playwright (for JavaScript-heavy pages)
const fetchHtmlWithPlaywright = async (url, retries = 3) => {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Set custom headers
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' }); // Wait for page load

    // Add another random delay of 1 to 5 seconds
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 4000 + 1000)));

    // Scroll the page to load additional content
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));

    // Add another random delay of 1 to 5 seconds
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 4000 + 1000)));
    
    const html = await page.content(); // Get HTML content of the page
    await browser.close();
    return html;
  } catch (error) {
    console.error(`Error navigating to URL with Playwright ${url}:`, error);

    // Check if it's a verification error and if there are retries left
    if (retries > 0) {
      console.log(`Waiting for 10 seconds before retrying...`);
      await sleep(10000); // 10-second wait
      return fetchHtmlWithPlaywright(url, retries - 1); // Retry fetching data
    }
  }
};

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
    requestNextPosFromParent(false);
    return;
  }

  const currentURL = url;
  console.log(`Bot processing URL at position ${pos}: ${currentURL}`);

  let htmlContent = await fetchHtmlWithPlaywright(currentURL); // Fetch HTML using Playwright
  if (htmlContent) {
    const $ = cheerio.load(htmlContent);

    // Find and insert new URLs into robotURL
    let urlList = findURLsInHTML($, currentURL);
    // Clean the urlList of duplicates to avoid inserting the same URL multiple times
    urlList = [...new Set(urlList)];
    urlList = urlList.filter((url) => url.startsWith("http")); // Filter out non-HTTP URLs (remove mailto, tel, etc.)
    urlList = urlList.slice(0, 20); // Limit the number of URLs to insert (prevents one page from spawning too many new URLs)
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
