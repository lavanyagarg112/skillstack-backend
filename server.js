const express = require("express");
const pool = require("./database/db");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Welcome to PostgreSQL with Node.js and Express!");
});

app.get("/checkconnection", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM check_connection");
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error connecting:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
