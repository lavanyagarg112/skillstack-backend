const express = require("express");
const cookieParser = require("cookie-parser");
const authRoutes = require("./routes/auth");
const orgRoutes = require("./routes/orgs");
const courseRoutes = require("./routes/courses");
const userRoutes = require("./routes/users");
const reportsRoutes = require("./routes/reports");
const onboardingRoutes = require("./routes/onboarding");
const roadmapRoutes = require("./routes/roadmaps");
const materialRoutes = require("./routes/materials");
const activityRoutes = require("./routes/activity");
const dashboardRoutes = require("./routes/dashboard");
const chatbotRoutes = require("./routes/chatbot");
const badgesRoutes = require("./routes/badges");
const pool = require("./database/db");
const app = express();
const PORT = process.env.PORT || 4000;
const path = require("path");
const fs = require("fs");
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

app.use(express.json());
app.use(cookieParser());

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", `${FRONTEND_URL}`);
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

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

app.use("/api", authRoutes);
app.use("/api/orgs", orgRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/roadmaps", roadmapRoutes);
app.use("/api/materials", materialRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/badges", badgesRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
