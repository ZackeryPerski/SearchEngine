const { parentPort, workerData } = require("worker_threads");
const axios = require("axios");
const cheerio = require("cheerio"); //library that makes it easier to parse html data
//regex is fine occassionally, but cheerio is better for parsing html data and handling complex html structures.

const { type } = require("os");

let currentURL = workerData.url;
let keyWordLimit = workerData.keyWordLimit; //This is k from the assignment, n is the number of URLs to eventually parse. Remember this for later.
let urlList = [];
let keyWordList = [];
let rankings = [];

//Threading Logic
//This function is called to acquire the next URL from the parent.
function requestNextURLFromParent(url = "") {
  parentPort.postMessage({ request: "getNext", url });
}

//This function is called after parsing a list of URLs to store the data in the database.
function storeParsedURLData(data = []) {
  parentPort.postMessage({ request: "storeURLs", data });
}

//This function is called after parsing tags from the html data.
function storeParsedTagsData(data = []) {
  parentPort.postMessage({ request: "storeTags", data });
}

//Axios and web request logic
//Function to retrieve data from the URL
async function retrievePageData(url) {
  try {
    const response = await axios.get(url, { timeout: 5000 });
    return response.data;
  } catch (error) {
    console.error("Error fetching data:", error.message);
    return null;
  }
}

//HTML Processing Logic
//Function to clean up and remove URL fragments
function removeURLFragment(url) {
  return url.split("#")[0];
}

//Function to transform relative URLs to absolute URLs
function transformRelativeURL(url) {
  if (url.startsWith("http")) {
    return url;
  } //if it starts with http, it is already an absolute URL

  return new URL(url, currentURL).href;
}

//Function to convert and clean up the URLs
function cleanURLs(urls) {
  return urls.map((url) => transformRelativeURL(removeURLFragment(url)));
}

//Function finds all URLs in the html data
function findURLsInHTML(htmlData) {
  if (typeof htmlData !== "string") {
    throw new Error("HTML data should be in string format"); //sanity check
  }

  let urlRegex = /href=["'](https?:\/\/[^"']+)["']/g;
  let urls = [];
  let match = urlRegex.exec(htmlData); //Truthy if a match is found, falsy if no match is found.
  while (match) {
    urls.push(match[1]);
    match = urlRegex.exec(htmlData);
  }
  return cleanURLs(urls); //Return the list of URLs found in the html data. These are the URLs to be parsed and cleaned.
}

//Function to build the keyWordList.
//TODO: Refactor this function for readability and maintainability.
function findKeyWordsInHTML(htmlData) {
  if (typeof htmlData !== "string") {
    throw new Error("HTML data should be in string format"); //sanity check
  }

  let tags = [];

  //Use cheerio to process the html data
  //We'll be using early out logic to limit the number of tags we parse.
  const $ = cheerio.load(htmlData);
  const metaTags = $('meta[name="keywords"]').attr("content");
  if (metaTags) {
    tags = metaTags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 3); //Filter here removes tags that are 2 characters or less.
    if (tags.length > keyWordLimit) {
      tags = tags.slice(0, keyWordLimit);
      return tags;
    }
  }
  //If we haven't found the keywords in the meta tags, we'll look next at the title tags.
  //Starting from here, we assume we might have pre-existing tags from the meta tags.
  const titleTags = $("title").text();
  if (titleTags) {
    let tempTags = titleTags
      .split(" ")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 3);
    tags = tags.concat(tempTags);
    if (tags.length > keyWordLimit) {
      tags = tags.slice(0, keyWordLimit);
      return tags;
    }
  }
  //If we haven't found the keywords in the title tags, we'll look next at the h1 tags.
  const h1Tags = $("h1").text();
  if (h1Tags) {
    let tempTags = h1Tags
      .split(" ")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 3);
    tags = tags.concat(tempTags);
    if (tags.length > keyWordLimit) {
      tags = tags.slice(0, keyWordLimit);
      return tags;
    }
  }
  //If we haven't found the keywords in the h1 tags, we'll look next at the h2 tags.
  const h2Tags = $("h2").text();
  if (h2Tags) {
    let tempTags = h2Tags
      .split(" ")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 3);
    tags = tags.concat(tempTags);
    if (tags.length > keyWordLimit) {
      tags = tags.slice(0, keyWordLimit);
      return tags;
    }
  }
  //If we haven't found the keywords in the h2 tags, we'll look next at the h3 tags.
  const h3Tags = $("h3").text();
  if (h3Tags) {
    let tempTags = h3Tags
      .split(" ")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 3);
    tags = tags.concat(tempTags);
    if (tags.length > keyWordLimit) {
      tags = tags.slice(0, keyWordLimit);
      return tags;
    }
  }
  //If we haven't found the keywords in the h3 tags, we'll look next at the h4 tags.
  const h4Tags = $("h4").text();
  if (h4Tags) {
    let tempTags = h4Tags
      .split(" ")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 3);
    tags = tags.concat(tempTags);
    if (tags.length > keyWordLimit) {
      tags = tags.slice(0, keyWordLimit);
      return tags;
    }
  }
  //If we haven't found the keywords in the h4 tags, we'll look next at the h5 tags.
  const h5Tags = $("h5").text();
  if (h5Tags) {
    let tempTags = h5Tags
      .split(" ")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 3);
    tags = tags.concat(tempTags);
    if (tags.length > keyWordLimit) {
      tags = tags.slice(0, keyWordLimit);
      return tags;
    }
  }
  //If we haven't found the keywords in the h5 tags, we'll look next at the h6 tags.
  const h6Tags = $("h6").text();
  if (h6Tags) {
    let tempTags = h6Tags
      .split(" ")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 3);
    tags = tags.concat(tempTags);
    if (tags.length > keyWordLimit) {
      tags = tags.slice(0, keyWordLimit);
      return tags;
    }
  }
  //If we STILL haven't found the keywords, we'll be looking at the body tags.
  const bodyTags = $("body").text();
  if (bodyTags) {
    let tempTags = bodyTags
      .split(" ")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length >= 3);
    tags = tags.concat(tempTags);
    if (tags.length > keyWordLimit) {
      tags = tags.slice(0, keyWordLimit);
      return tags;
    }
  }

  return tags; //If we get here, we have less than k keywords to return. will need to do some additional processing
}

//Function to build the rankings for the keywords
function findRankings(keyWordList, htmlData) {
  //employing simple regex to find the number of times a keyword appears in the html data, ignoring case and tags of the same name.
  let rankings = [];
  let cleanedData = htmlData.replace(/<[^>]*>/g, " "); //Remove all html tags from the data.

  keyWordList.forEach((keyWord) => {
    let regex = new RegExp(`\\b${keyWord}\\b`, "gi"); //this regex will match the keyword, ignoring case and only matching whole words.
    let matches = cleanedData.match(regex);
    rankings.push(matches.length);
  });
  return rankings;
}

function main() {
  //Retrieve the page data
  retrievePageData(currentURL)
    .then((htmlData) => {
      //Check if the data is valid html. If it is, parse it, otherwise, do nothing and continue.
      if (
        htmlData !== null &&
        htmlData !== undefined &&
        typeof htmlData === "string"
      ) {
        //Parse the html data
        urlList = findURLsInHTML(htmlData);
        keyWordList = findKeyWordsInHTML(htmlData);
        //It's possible that keyWordList is empty. If it is, we'll need to request the next URL from the parent.
        //No point in storing an entry with no keywords.
        //TODO: Add logic to handle this case.

        //Build rankings for the keywords. There's at least one keyword in the list.
        rankings = findRankings(keyWordList, htmlData);

        //Store the data in the database
        storeParsedURLData(urlList);
        storeParsedTagsData(keyWordList);
      }
    })
    .catch((error) => {
      console.error("Error fetching data:", error.message);
    });
}

//TODO: listening for messages from the parent.

//This kickstarts the process
requestDataFromParent(currentURL);
