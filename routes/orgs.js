const express = require("express");
const pool = require("../database/db");
const router = express.Router();
const crypto = require("crypto");
const logActivity = require("./activityLogger");

function setAuthCookie(res, payload) {
  res.cookie("auth", JSON.stringify(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

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

    const orgRes = await client.query(
      `INSERT INTO organisations (organisation_name, admin_user_id)
       VALUES ($1, $2)
       RETURNING id, organisation_name, created_at`,
      [organisationName, userId]
    );
    const org = orgRes.rows[0];

    await client.query(
      `INSERT INTO organisation_users (user_id, organisation_id, role)
       VALUES ($1, $2, 'admin')`,
      [userId, org.id]
    );

    await client.query("COMMIT");
    await logActivity({
      userId,
      organisationId: org.id,
      action: "create_organisation",
      metadata: { organisationId: org.id },
    });
    return res.status(201).json({ organisation: { ...org, role: "admin" } });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
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
  const { inviteCode } = req.body;
  if (!inviteCode) {
    return res
      .status(400)
      .json({ message: "organisation invite code is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orgRes = await client.query(
      `SELECT id, organisation_name FROM organisations WHERE current_invitation_id = $1`,
      [inviteCode]
    );
    if (!orgRes.rows.length) {
      return res.status(400).json({ message: "Organization not found" });
    }
    const org = orgRes.rows[0];
    const organisationId = org.id;

    await client.query(
      `INSERT INTO organisation_users (user_id, organisation_id, role)
       VALUES ($1, $2, 'employee')`,
      [userId, organisationId]
    );

    await client.query("COMMIT");

    setAuthCookie(res, {
      ...session,
      organisation: {
        id: org.id,
        organisationname: org.organisation_name,
        role: "employee",
      },
    });
    await logActivity({
      userId,
      organisationId,
      action: "add_employee",
      metadata: { organisationId },
    });

    return res.status(201).json({ organisation: { ...org, role: "employee" } });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

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
         o.organisation_name AS organisationname,
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

    return res.json({ organisation: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/settings", async (req, res) => {
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
         o.organisation_name,
         o.ai_enabled,
         o.description
       FROM organisations o
         where o.admin_user_id = $1`,
      [session.userId]
    );

    if (!result.rows.length) {
      return res.status(400).json({ message: "Organization not found" });
    }

    return res.json({ organisation: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/settings", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const { organisation_id, organisation_name, ai_enabled, description } =
    req.body;

  if (!organisation_id || !organisation_name) {
    return res
      .status(400)
      .json({ message: "organisation_id and organisation_name are required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updateRes = await client.query(
      `
      UPDATE organisations
         SET organisation_name = $1,
             ai_enabled       = $2,
             description      = $3
       WHERE id = $4
         AND admin_user_id = $5
       RETURNING id, organisation_name, ai_enabled, description
      `,
      [organisation_name, ai_enabled, description, organisation_id, userId]
    );

    if (!updateRes.rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ message: "Not authorized to update this organization" });
    }

    await client.query("COMMIT");

    const mem = await pool.query(
      `SELECT
     o.id                    AS id,
     o.organisation_name     AS organisationname,
     ou.role                 AS role
   FROM organisation_users ou
   JOIN organisations o
     ON o.id = ou.organisation_id
   WHERE ou.user_id = $1`,
      [userId]
    );

    const neworganisation = mem.rows[0] || null;

    // Regenerate auth cookie
    setAuthCookie(res, {
      ...session,
      organisation: neworganisation,
    });

    await logActivity({
      userId,
      organisationId: organisation_id,
      action: "update_organisation_settings",
      metadata: {
        organisationId: organisation_id,
        ai_enabled,
        description,
      },
    });

    return res.json({ organisation: updateRes.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.get("/generate-invite-code", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const organisationId = session.organisation?.id;
  const organisationRole = session.organisation?.role;
  if (organisationRole !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inviteCode = organisationId + crypto.randomBytes(16).toString("hex");

    const updateRes = await client.query(
      `UPDATE organisations
         SET current_invitation_id = $1
       WHERE id = $2
         AND admin_user_id = $3
       RETURNING current_invitation_id`,
      [inviteCode, organisationId, userId]
    );

    if (!updateRes.rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ message: "Organization not found or not owned by you" });
    }

    await client.query("COMMIT");
    await logActivity({
      userId,
      organisationId,
      action: "generate_invite_code",
      metadata: { organisationId, inviteCode },
    });
    return res.json({ inviteCode: updateRes.rows[0].current_invitation_id });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error generating invite code:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.get("/get-curent-invitecode", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const organisationId = session.organisation?.id;
  const organisationRole = session.organisation?.role;
  if (organisationRole !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    const result = await pool.query(
      `SELECT current_invitation_id
         FROM organisations
        WHERE id = $1 AND admin_user_id = $2`,
      [organisationId, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Invitation code not found" });
    }

    return res.json({ inviteCode: result.rows[0].current_invitation_id });
  } catch (err) {
    console.error("Error fetching invite code:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
