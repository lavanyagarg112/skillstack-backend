const express = require("express");
const pool = require("../database/db");
const router = express.Router();

router.get("/", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const organisationId = session.organisation?.id;
  const organisationRole = session.organisation?.role;
  if (organisationRole !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const client = await pool.connect();
  try {
    const users = await client.query(
      `SELECT u.id, u.firstname, u.lastname, u.email, ou.role
   FROM users u
   JOIN organisation_users ou ON u.id = ou.user_id
   WHERE ou.organisation_id = $1`,
      [organisationId]
    );
    await client.query("COMMIT");
    return res.status(201).json(users.rows);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error.message);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.delete("/", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const organisationRole = session.organisation?.role;
  if (organisationRole !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { userId: deleteUserId } = req.body;
  if (!deleteUserId) {
    return res.status(400).json({ message: "Missing user ID to delete" });
  }

  const client = await pool.connect();
  try {
    const delRes = await client.query(
      `DELETE FROM users
         WHERE id = $1
         RETURNING id`,
      [deleteUserId]
    );
    if (!delRes.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }
    await client.query("COMMIT");
    return res.status(201).json({
      message: "User deleted successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error.message);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
