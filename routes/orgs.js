// routes/orgs.js
const express = require("express");
const pool = require("../database/db");
const router = express.Router();

// Create a new organization AND make the current user its admin
router.post("/", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const { organisationName } = req.body;
  if (!organisationName) {
    return res.status(400).json({ message: "organisationName is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Insert into organisations
    const orgRes = await client.query(
      `INSERT INTO organisations (organisation_name, admin_user_id)
       VALUES ($1, $2)
       RETURNING id, organisation_name, created_at`,
      [organisationName, userId]
    );
    const org = orgRes.rows[0];

    // 2) Link user → new org as admin
    await client.query(
      `INSERT INTO organisation_users (user_id, organisation_id, role)
       VALUES ($1, $2, 'admin')`,
      [userId, org.id]
    );

    await client.query("COMMIT");
    return res.status(201).json({ organisation: { ...org, role: "admin" } });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    // unique violation on org name
    if (err.code === "23505") {
      if (
        err.constraint === "organisations_organisation_name_admin_user_id_key"
      ) {
        return res
          .status(400)
          .json({ message: "Organization name already taken" });
      }
    }
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/addemployee", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const { organisationId } = req.body;
  if (!organisationId) {
    return res
      .status(400)
      .json({ message: "organisation invite code is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) See if org exists
    const orgRes = await client.query(
      `SELECT id, organisation_name FROM organisations WHERE id = $1`,
      [organisationId]
    );
    if (!orgRes.rows.length) {
      return res.status(400).json({ message: "Organization not found" });
    }
    const org = orgRes.rows[0];

    // 2) Link user → new org as employee
    await client.query(
      `INSERT INTO organisation_users (user_id, organisation_id, role)
       VALUES ($1, $2, 'employee')`,
      [userId, organisationId]
    );

    await client.query("COMMIT");
    return res.status(201).json({ organisation: { ...org, role: "employee" } });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

// Get the single organization (and role) for the current user
router.get("/my", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  try {
    const result = await pool.query(
      `SELECT
         o.id,
         o.organisation_name AS organisationName,
         ou.role
       FROM organisation_users ou
       JOIN organisations o
         ON o.id = ou.organisation_id
       WHERE ou.user_id = $1`,
      [session.userId]
    );

    if (!result.rows.length) {
      // no org yet
      return res.json({ organisation: null });
    }

    // exactly one row guaranteed by PK on user_id
    return res.json({ organisation: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
