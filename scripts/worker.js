const { parentPort, workerData } = require("worker_threads");
const axios = require("axios");
const cheerio = require("cheerio"); // library that makes it easier to parse HTML data

let currentURL = workerData.url; // Assume we start with the first URL in the list.
let keyWordLimit = workerData.keyWordLimit; // This is k from the assignment.
let descriptionLength = workerData.descriptionLength; // Maximum length of the description to store in the database.
let halt = workerData.halt; // A flag to stop the worker from processing more URLs, set by the parent thread.

// Threading Logic
function getNextURLFromParent() {
  parentPort.postMessage({ request: "getNextURL" });
}

function storeRobotURLs(urls = []) {
  parentPort.postMessage({ request: "storeRobotURLs", urls });
}

function storeParsedTagsData(tags = [], ranks = [], url = "") {
  parentPort.postMessage({ request: "storeTags", tags, ranks, url });
}

function storeDescriptionData(description = "", url = "") {
  parentPort.postMessage({ request: "storeDescription", description, url });
}

// Axios and web request logic
async function retrievePageData(url) {
  try {
    const response = await axios.get(url, { timeout: 5000 });
    return response.data;
  } catch (error) {
    console.error("Error fetching data:", error.message);
    return null;
  }
}

// HTML Processing Logic
function removeURLFragment(url) {
  return url.split("#")[0];
}

function transformRelativeURL(url) {
  if (url.startsWith("http")) return url;
  return new URL(url, currentURL).href;
}

function findURLsInHTML($) {
  let urls = [];
  $("a[href]").each((_, element) => {
    let url = $(element).attr("href");
    if (url) urls.push(transformRelativeURL(removeURLFragment(url)));
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
    if (tags.length > keyWordLimit) return tags.slice(0, keyWordLimit);
  }

  let targetTags = ["title", "h1", "h2", "h3", "h4", "h5", "h6", "body"];
  targetTags.forEach((tag) => {
    let tempTags = getKeywordsFromTargetTag(tag, $);
    tags = tags.concat(tempTags);
    if (tags.length > keyWordLimit) {
      tags = tags.slice(0, keyWordLimit);
      return;
    }
  });
  return tags;
}

//Helper function to get keywords from target tags
function getKeywordsFromTargetTag(tag, $) {
  const targetTags = $(tag).text();
  return targetTags
    ? targetTags
        .split(" ")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length >= 3)
    : [];
}

function findRankings(keyWordList, $) {
  let rankings = [];
  let cleanedData = $.text().replace(/<[^>]*>/g, " ");

  keyWordList.forEach((keyWord, index) => {
    let regex = new RegExp(`\\b${keyWord}\\b`, "gi");
    let matches = cleanedData.match(regex);
    let count = matches ? matches.length : 0;
    rankings.push(count + findRankingsInMetaTags(keyWord, $));
  });
  return rankings;
}

//Helper function to find rankings in meta tags
function findRankingsInMetaTags(keyword, $) {
  let metaTags = $('meta[name="keywords"]').attr("content");
  if (metaTags) {
    let regex = new RegExp(`\\b${keyword}\\b`, "gi");
    let matches = metaTags.match(regex);
    return matches ? matches.length : 0;
  }
  return 0;
}

function buildDescription($, length) {
  let description = $('meta[name="description"]').attr("content");
  if (description !== undefined && description.length > length) {
    return description.slice(0, length);
  }

  description = "";
  let targetTags = ["title", "h1", "h2", "h3", "h4", "h5", "h6", "body"];
  targetTags.forEach((tag) => {
    let tempDescription = getDescriptionFromTargetTag(tag, $);
    if (tempDescription.length > 0) {
      description +=
        description.length > 0 ? " " + tempDescription : tempDescription;
      if (description.length > length) {
        description = description.slice(0, length);
        return;
      }
    }
  });
  return description;
}

//Helper function to get description from target tags
function getDescriptionFromTargetTag(tag, $) {
  return $(tag).text() || "";
}

async function main() {
  if (!halt) {
    let htmlData = await retrievePageData(currentURL);
    if (htmlData && typeof htmlData === "string") {
      const $ = cheerio.load(htmlData);
      let urlList = findURLsInHTML($);
      let keyWordList = findKeyWordsInHTML($);

      if (keyWordList.length !== 0 && !halt) {
        let rankings = findRankings(keyWordList, $);
        let description = buildDescription($, descriptionLength);
        storeParsedTagsData(keyWordList, rankings, currentURL);
        storeDescriptionData(description, currentURL);
        storeRobotURLs(urlList);
      }
    }
    getNextURLFromParent();
  }
}

parentPort.on("message", async (message) => {
  if (message.request === "start") {
    await main();
  } else if (message.request === "newURL") {
    currentURL = message.url;
    await main();
  } else if (message.request === "halt") {
    halt = true;
  }
});
