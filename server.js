const express = require("express");
const cookieParser = require("cookie-parser");
const authRoutes = require("./routes/auth");
const orgRoutes = require("./routes/orgs");
const courseRoutes = require("./routes/courses");
const pool = require("./database/db");
const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(cookieParser());

// optional CORS settings if Next.js runs on a different origin
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:3000");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// your existing endpoints
app.get("/", (req, res) =>
  res.send("Welcome to PostgreSQL with Node.js and Express!")
);
app.get("/checkconnection", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM check_connection");
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error connecting:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// mount all auth routes under /api
app.use("/api", authRoutes);
app.use("/api/orgs", orgRoutes);
app.use("/api/courses", courseRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
