// worker.js

const { parentPort, workerData } = require("worker_threads");
const { chromium } = require("playwright");
const cheerio = require("cheerio");
const {
  initializeConnection,
  retrieveRobotURLByPos,
  insertIntoRobotURL,
  insertIntoURLDescription,
  insertIntoURLKeyword,
} = require("./mySQLHelpers.js");

const keyWordLimit = workerData.K;
const descriptionLength = workerData.DESCRIPTION_LENGTH;
let halt = false;

// Function to request the next position from the main thread
function requestNextPosFromParent(success = true) {
  console.log("Worker requesting next position from parent");
  parentPort.postMessage({ request: "getNextPos", success });
}

// Function to fetch HTML with Playwright (for JavaScript-heavy pages)
const fetchHtmlWithPlaywright = async (url, retries = 3) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 ... Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });

    await new Promise((resolve) =>
      setTimeout(resolve, Math.floor(Math.random() * 4000 + 1000))
    );

    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await new Promise((resolve) =>
      setTimeout(resolve, Math.floor(Math.random() * 4000 + 1000))
    );

    const html = await page.content();
    await browser.close();
    return html;
  } catch (error) {
    console.error(`Error navigating to URL with Playwright ${url}:`, error);

    if (retries > 0) {
      console.log(`Retrying... (${4 - retries} attempt(s) left)`);
      await sleep(10000);
      return fetchHtmlWithPlaywright(url, retries - 1);
    }
  }
};

// Function to process phrase search requests with AND/OR mode
async function processPhraseSearch(phrases, pos, orMode) {
  console.time(`processPhraseSearch at position ${pos}`);
  const url = await retrieveRobotURLByPos(pos);
  if (!url) {
    console.warn(`No URL found at position ${pos}`);
    parentPort.postMessage({ request: "searchResult", result: null });
    return;
  }

  let htmlContent = await fetchHtmlWithPlaywright(url);
  if (!htmlContent) {
    console.log(`Failed to retrieve or parse HTML for URL: ${url}`);
    parentPort.postMessage({ request: "searchResult", result: null });
    return;
  }

  const $ = cheerio.load(htmlContent);
  const content = $.root().text();

  let rank = 0;
  let allPhrasesFound = true;

  for (const phrase of phrases) {
    const regex = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "gi");
    const matches = content.match(regex);
    const occurrences = matches ? matches.length : 0;

    if (orMode) {
      rank += occurrences;
    } else {
      if (occurrences > 0) {
        rank += occurrences;
      } else {
        allPhrasesFound = false;
        break;
      }
    }
  }

  if (orMode || allPhrasesFound) {
    parentPort.postMessage({
      request: "searchResult",
      result: { url: url, rank: rank },
    });
  } else {
    parentPort.postMessage({ request: "searchResult", result: null });
  }
  console.timeEnd(`processPhraseSearch at position ${pos}`);
}

// Function to process URL by position (original functionality)
async function processURLByPos(pos) {
  console.time(`processURLByPos at position ${pos}`);
  const url = await retrieveRobotURLByPos(pos);
  if (!url) {
    console.warn(`No URL found at position ${pos}`);
    requestNextPosFromParent(false);
    return;
  }

  console.log(`Bot processing URL at position ${pos}: ${url}`);

  let htmlContent = await fetchHtmlWithPlaywright(url);
  if (htmlContent) {
    const $ = cheerio.load(htmlContent);

    let urlList = findURLsInHTML($, url);
    urlList = [...new Set(urlList)].filter((url) => url.startsWith("http"));
    urlList = urlList.slice(0, 20);
    for (const newURL of urlList) {
      await insertIntoRobotURL(newURL);
    }

    let keyWordList = findKeyWordsInHTML($);
    if (keyWordList.length > 0 && !halt) {
      let rankings = findRankings(keyWordList, $);

      await insertIntoURLKeyword(url, keyWordList, rankings);
      let description = buildDescription($, descriptionLength);
      await insertIntoURLDescription(url, description);
    } else {
      console.log(`No keywords found for URL: ${url}`);
    }
  } else {
    console.log(`Failed to retrieve or parse HTML for URL: ${url}`);
  }

  console.log(
    `Completed processing URL at position ${pos}. Requesting next position.`
  );
  console.timeEnd(`processURLByPos at position ${pos}`);
  requestNextPosFromParent();
}

// Utility functions for original functionality
function findURLsInHTML($, currentURL) {
  let urls = [];
  $("a[href]").each((_, element) => {
    let url = $(element).attr("href");
    if (url)
      urls.push(transformRelativeURL(removeURLFragment(url), currentURL));
  });
  return urls;
}

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

function findRankingsInMetaTags(keyword, $) {
  let metaTags = $('meta[name="keywords"]').attr("content");
  if (metaTags) {
    let regex = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "gi");
    let matches = metaTags.match(regex);
    return matches ? matches.length : 0;
  }
  return 0;
}

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

// Message handling from parent process
parentPort.on("message", async (message) => {
  console.log("Worker received message:", message);

  if (
    message.request === "phraseSearch" &&
    message.phrases &&
    message.pos !== undefined
  ) {
    console.log(`Processing phraseSearch for position ${message.pos}`);
    await processPhraseSearch(message.phrases, message.pos, message.or);
  } else if (message.pos !== undefined) {
    if (message.pos !== null) {
      console.log(`Processing URL at position ${message.pos}`);
      await processURLByPos(message.pos);
    } else {
      console.log("No more URLs to process. Worker exiting.");
      process.exit(0);
    }
  } else if (message.request === "halt") {
    halt = true;
    console.log("Worker received halt request.");
  }
});
