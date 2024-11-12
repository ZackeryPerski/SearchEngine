// mySQLHelpers.js

const mysql = require("mysql2/promise");

let connection;

// Create a function to establish the database connection
const initializeConnection = async () => {
  if (!connection) {
    try {
      connection = await mysql.createConnection({
        host: "3.19.239.97",
        user: "COSC631",
        password: "COSC631",
        database: "cosc631",
      });
      console.log("Database connection established");
    } catch (err) {
      console.error("Error establishing database connection: ", err);
      process.exit(1); // Exit if connection fails
    }
  }
};

//------------------------------ Initialization Functions ------------------------------//
const truncateTable = async (tableName) => {
  await initializeConnection(); // Ensure connection is established
  try {
    await connection.query(`TRUNCATE TABLE ${tableName}`);
    console.log(`Truncated table ${tableName}`);
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") {
      console.log(`Table ${tableName} does not exist, skipping truncation.`);
    } else {
      console.error(`Error truncating table ${tableName}: `, err);
    }
  }
};

const initializeRobotURLTable = async () => {
  await initializeConnection(); // Ensure connection is established
  try {
    await truncateTable("robotURL");
    await connection.query(
      "CREATE TABLE IF NOT EXISTS robotURL (" +
        "`url` VARCHAR(255) PRIMARY KEY, " +
        "`pos` INT NOT NULL AUTO_INCREMENT, " +
        "INDEX (`pos`)" +
        ") ENGINE=InnoDB AUTO_INCREMENT=1"
    );
    console.log("Created table robotURL with InnoDB engine");
  } catch (err) {
    console.error("Error creating table robotURL: ", err);
  }
};

const initializeURLDescriptionTable = async (descriptionLength) => {
  await initializeConnection(); // Ensure connection is established
  try {
    await truncateTable("urlDescription");
    await connection.query(
      `CREATE TABLE IF NOT EXISTS urlDescription (` +
        "`url` VARCHAR(255) PRIMARY KEY, " +
        `\`description\` VARCHAR(${descriptionLength})` +
        ") ENGINE=InnoDB"
    );
    console.log("Created table urlDescription");
  } catch (err) {
    console.error("Error creating table urlDescription: ", err);
  }
};

const initializeURLKeywordTable = async () => {
  await initializeConnection(); // Ensure connection is established
  try {
    await truncateTable("urlKeyword");
    await connection.query(
      "CREATE TABLE IF NOT EXISTS urlKeyword (" +
        "`url` VARCHAR(255), " +
        "`keyword` VARCHAR(255), " +
        "`rank` INT NOT NULL, " +
        "PRIMARY KEY (`url`, `keyword`)" +
        ") ENGINE=InnoDB"
    );
    console.log("Created table urlKeyword");
  } catch (err) {
    console.error("Error creating table urlKeyword: ", err);
  }
};

// Initialize all tables
const initializeTables = async (descriptionLength) => {
  await initializeRobotURLTable();
  await initializeURLDescriptionTable(descriptionLength);
  await initializeURLKeywordTable();
};

const initializeDatabase = async (descriptionLength = 255) => {
  try {
    // Initialize the database connection and tables
    await initializeTables(descriptionLength);
    console.log("All tables initialized");
    return true;
  } catch (error) {
    console.error("Error initializing tables: ", error.message);
    return false;
  }
};

//------------------------------ Insert Functions ------------------------------//

const insertIntoRobotURL = async (url) => {
  await initializeConnection();
  try {
    // Attempt to insert the new URL; ignore if it already exists
    await connection.query("INSERT IGNORE INTO robotURL (url) VALUES (?)", [
      url,
    ]);
    console.log(`Inserted URL ${url} into robotURL (or ignored if duplicate)`);
  } catch (err) {
    console.error(`Error inserting URL ${url} into robotURL: `, err);
  }
};

const insertIntoURLDescription = async (url, description) => {
  await initializeConnection(); // Ensure connection is established
  try {
    await connection.query(
      "INSERT INTO urlDescription (url, description) VALUES (?, ?) " +
        "ON DUPLICATE KEY UPDATE description = VALUES(description)",
      [url, description]
    );
    console.log(`Inserted description for URL ${url} into urlDescription`);
  } catch (err) {
    console.error(
      `Error inserting description for URL ${url} into urlDescription: `,
      err
    );
  }
};

const insertIntoURLKeyword = async (url, keywords, ranks) => {
  await initializeConnection(); // Ensure connection is established
  if (keywords.length !== ranks.length) {
    console.error("Keywords and ranks arrays must have the same length.");
    return;
  }
  try {
    const values = keywords.map((keyword, index) => [
      url,
      keyword,
      ranks[index],
    ]);
    await connection.query(
      "INSERT INTO urlKeyword (url, keyword, `rank`) VALUES ? " +
        "ON DUPLICATE KEY UPDATE `rank` = VALUES(`rank`)",
      [values]
    );
    console.log(`Inserted keywords for URL ${url} into urlKeyword`);
  } catch (err) {
    console.error(
      `Error inserting keywords for URL ${url} into urlKeyword: `,
      err
    );
  }
};

//------------------------------ Query Functions ------------------------------//
const retrieveRobotURLByPos = async (pos) => {
  await initializeConnection(); // Ensure connection is established
  try {
    const [rows] = await connection.query(
      "SELECT url FROM robotURL WHERE pos = ?",
      [pos]
    );
    if (rows.length === 0) {
      console.warn(`No URL found at position ${pos}`);
      return null;
    }
    return rows[0].url;
  } catch (err) {
    console.error(`Error retrieving URL at position ${pos}: `, err);
    return null;
  }
};

const retrieveRobotURLCount = async () => {
  await initializeConnection(); // Ensure connection is established
  try {
    const [rows] = await connection.query(
      "SELECT COUNT(*) as count FROM robotURL"
    );
    return rows[0].count;
  } catch (err) {
    console.error(`Error retrieving count of robotURL: `, err);
    return null;
  }
};

const retrieveDescriptionURLCount = async () => {
  await initializeConnection(); // Ensure connection is established
  try {
    const [rows] = await connection.query(
      "SELECT COUNT(*) as count FROM urlDescription"
    );
    return rows[0].count;
  } catch (err) {
    console.error(`Error retrieving count of urlDescription: `, err);
    return null;
  }
};

// Search for positions that contain the given keyword in their URL
// Returns an array of positions to be used for web crawling based off of the keyword that is contained in the URL
// Called by searchEngine.js to determine which URLs to crawl
const searchPositionsByKeyword = async (keyword) => {
  await initializeConnection(); // Ensure connection is established

  if (!keyword) {
    // No keyword to search for
    return [];
  }

  let query = "SELECT pos FROM robotURL WHERE url LIKE ?";
  const modifiedKeyword = `%${keyword}%`;

  try {
    const [rows] = await connection.query(query, [modifiedKeyword]);
    console.log("Positions containing the Keyword Specified: ", rows);
    return rows.map((row) => row.pos);
  } catch (err) {
    console.error(`Error searching for keyword: `, err);
    return [];
  }
};

const searchURLAndRankByKeywords = async (keywords, OR = true) => {
  await initializeConnection(); // Ensure connection is established

  if (keywords.length === 0) {
    // No keywords to search for
    return [];
  }

  let query =
    "SELECT urlKeyword.url as url, " +
    "urlDescription.description as description, " +
    "SUM(urlKeyword.`rank`) as `rank` " +
    "FROM urlKeyword " +
    "INNER JOIN urlDescription ON urlKeyword.url = urlDescription.url " +
    "WHERE ";

  // Use LIKE for partial matching of keywords
  const conditions = keywords
    .map(() => "keyword LIKE ?")
    .join(OR ? " OR " : " AND ");
  query += conditions;

  query += " GROUP BY url " + "ORDER BY `rank` DESC";

  // Modify keywords array to work with LIKE (appending a bunch of wildcards to allow partial matching)
  const modifiedKeywords = keywords.map((keyword) => `%${keyword}%`);

  //For debugging...
  console.log("Query: ", query);
  console.log("Modified keywords: ", modifiedKeywords);

  try {
    const [rows] = await connection.query(query, modifiedKeywords);
    return rows;
  } catch (err) {
    console.error(`Error searching for keywords: `, err);
    return [];
  }
};

// Export the functions

module.exports = {
  initializeDatabase,
  insertIntoRobotURL,
  insertIntoURLDescription,
  insertIntoURLKeyword,
  retrieveRobotURLByPos,
  retrieveRobotURLCount,
  retrieveDescriptionURLCount,
  searchURLAndRankByKeywords,
  searchPositionsByKeyword,
};
