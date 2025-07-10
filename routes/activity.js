const express = require("express");
const pool = require("../database/db");
const router = express.Router();

function getAuthUser(req) {
  const { auth } = req.cookies;
  if (!auth) return null;
  try {
    return JSON.parse(auth);
  } catch {
    return null;
  }
}

router.get("/", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }
  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        user_id,
        action,
        display_metadata as metadata,
        created_at
      FROM activity_logs
      WHERE organisation_id = $1 AND
      user_id = $2
      ORDER BY created_at DESC
      LIMIT 100
    `,
      [organisationId, user.userId]
    );
    res.json({ logs: rows });
  } catch (err) {
    console.error("Error fetching activity logs:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
