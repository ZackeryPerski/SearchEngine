const mysql = require("mysql2/promise");

// Create a connection to the database
const connection = await mysql.createConnection({
  host: "18.217.106.69",
  user: "COSC631",
  password: "COSC631",
  database: "cosc631",
});

//------------------------------ Initialization Functions ------------------------------//
// Function to truncate a table
const truncateTable = async (tableName) => {
  try {
    await connection.query(`TRUNCATE TABLE ${tableName}`);
    console.log(`Truncated table ${tableName}`);
  } catch (err) {
    console.error(`Error truncating table ${tableName}: `, err);
  }
};

// Initialize the robotURL table
const initializeRobotURLTable = async () => {
  try {
    await truncateTable("robotURL");
    await connection.query(
      "CREATE TABLE IF NOT EXISTS robotURL (url VARCHAR(255) PRIMARY KEY, pos INT AUTO_INCREMENT)"
    );
    console.log("Created table robotURL");
  } catch (err) {
    console.error("Error creating table robotURL: ", err);
  }
};

// Initialize the description table
const initializeURLDescriptionTable = async (descriptionLength) => {
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

// Initialize the keyword table
const initializeURLKeywordTable = async () => {
  try {
    await truncateTable("urlKeyword");
    await connection.query(
      "CREATE TABLE IF NOT EXISTS urlKeyword (url VARCHAR(255), keyword VARCHAR(255), rank INT NOT NULL, PRIMARY KEY (url, keyword))"
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
  // Create a connection to the database
  await initializeTables(descriptionLength)
    .then(() => {
      console.log("All tables initialized");
      return true;
    })
    .catch((error) => {
      console.error("Error initializing tables: ", error);
      return false;
    });
};

//------------------------------ Insert Functions ------------------------------//
//self-explanatory
const insertIntoRobotURL = async (url) => {
  try {
    await connection.query("INSERT INTO robotURL (url) VALUES (?)", [url]);
    console.log(`Inserted URL ${url} into robotURL`);
  } catch (err) {
    console.error(`Error inserting URL ${url} into robotURL: `, err);
  }
};

const insertIntoURLDescription = async (url, description) => {
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
//Grabs the URL at a specific position in the robotURL table
const retrieveRobotURLByPos = async (pos) => {
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

//Retrieves the current number of entries in the robotURL table
const retrieveRobotURLCount = async () => {
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
  //keywords is assumed to be an array of keywords
  //early return if keywords is empty, nothing to search for
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

  //add the keyword search to the query, as well as the OR/AND logic
  for (let i = 0; i < keywords.length - 1; i++) {
    if (OR) {
      query += `keyword = ? OR `;
    } else {
      query += `keyword = ? AND `;
    }
  }
  query += "keyword = ?";

  //Wrap up the query with the GROUP BY and ORDER BY clauses
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
