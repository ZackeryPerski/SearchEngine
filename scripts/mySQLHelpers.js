const mysql = require("mysql2/promise");

let connection;

// Create a function to establish the database connection
const initializeConnection = async () => {
  if (!connection) {
    try {
      connection = await mysql.createConnection({
        host: "18.217.106.69",
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
      "CREATE TABLE IF NOT EXISTS robotURL (url VARCHAR(255) PRIMARY KEY, pos INT AUTO_INCREMENT, INDEX (pos))"
    );
    console.log("Created table robotURL");
  } catch (err) {
    console.error("Error creating table robotURL: ", err);
  }
};

const initializeURLDescriptionTable = async (descriptionLength) => {
  await initializeConnection(); // Ensure connection is established
  try {
    await truncateTable("urlDescription");
    await connection.query(
      `CREATE TABLE IF NOT EXISTS urlDescription (url VARCHAR(255) PRIMARY KEY, description VARCHAR(${descriptionLength}))`
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
      "CREATE TABLE IF NOT EXISTS urlKeyword (url VARCHAR(255), keyword VARCHAR(255), `rank` INT NOT NULL, PRIMARY KEY (url, keyword))"
    );
    console.log("Created table urlKeyword");
  } catch (err) {
    console.error("Error creating table urlKeyword: ", err);
  }
};

// Call these functions in an async context
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
  await initializeConnection(); // Ensure connection is established
  try {
    await connection.query("INSERT INTO robotURL (url) VALUES (?)", [url]);
    console.log(`Inserted URL ${url} into robotURL`);
  } catch (err) {
    console.error(`Error inserting URL ${url} into robotURL: `, err);
  }
};

const insertIntoURLDescription = async (url, description) => {
  await initializeConnection(); // Ensure connection is established
  try {
    await connection.query(
      "INSERT INTO urlDescription (url, description) VALUES (?, ?)",
      [url, description]
    );
    console.log(`Inserted URL ${url} into urlDescription`);
  } catch (err) {
    console.error(`Error inserting URL ${url} into urlDescription: `, err);
  }
};

const insertIntoURLKeyword = async (url, keyword, rank) => {
  await initializeConnection(); // Ensure connection is established
  try {
    await connection.query(
      "INSERT INTO urlKeyword (url, keyword, rank) VALUES (?, ?, ?)",
      [url, keyword, rank]
    );
    console.log(`Inserted URL ${url} into urlKeyword`);
  } catch (err) {
    console.error(`Error inserting URL ${url} into urlKeyword: `, err);
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

const searchURLAndRankByKeywords = async (keywords, OR = true) => {
  await initializeConnection(); // Ensure connection is established

  if (keywords.length === 0) {
    return [];
  }

  let query =
    "SELECT urlKeyword.url as url, " +
    "urlDescription.description as description, " +
    "SUM(urlKeyword.rank) as rank " +
    "FROM urlKeyword " +
    "INNER JOIN urlDescription ON urlKeyword.url = urlDescription.url " +
    "WHERE ";

  for (let i = 0; i < keywords.length - 1; i++) {
    if (OR) {
      query += `keyword = ? OR `;
    } else {
      query += `keyword = ? AND `;
    }
  }
  query += "keyword = ?";

  query += " GROUP BY url " + "ORDER BY rank DESC";

  try {
    const [rows] = await connection.query(query, keywords);
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
  searchURLAndRankByKeywords,
};
