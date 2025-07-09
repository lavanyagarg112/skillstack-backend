const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../database/db");
const router = express.Router();

function setAuthCookie(res, payload) {
  res.cookie("auth", JSON.stringify(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

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

router.put("/profile", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const { firstname, lastname, email } = req.body;
  if (!firstname || !lastname || !email) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const emailCheck = await client.query(
      "SELECT id FROM users WHERE email = $1 AND id != $2",
      [email, session.userId]
    );
    if (emailCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Email already in use" });
    }

    const updateResult = await client.query(
      "UPDATE users SET firstname = $1, lastname = $2, email = $3 WHERE id = $4 RETURNING id, firstname, lastname, email",
      [firstname, lastname, email, session.userId]
    );

    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "User not found" });
    }

    const updatedUser = updateResult.rows[0];

    const updatedSession = {
      ...session,
      firstname: updatedUser.firstname,
      lastname: updatedUser.lastname,
      email: updatedUser.email,
    };

    setAuthCookie(res, updatedSession);

    await client.query("COMMIT");
    return res.json({
      message: "Profile updated successfully",
      user: updatedSession,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating profile:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.put("/password", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (newPassword.length < 8) {
    return res
      .status(400)
      .json({ message: "New password must be at least 8 characters long" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [session.userId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "User not found" });
    }

    const currentPasswordHash = userResult.rows[0].password_hash;

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      currentPasswordHash
    );
    if (!isCurrentPasswordValid) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      newPasswordHash,
      session.userId,
    ]);

    await client.query("COMMIT");
    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating password:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.get("/skills", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const client = await pool.connect();
  try {
    const userSkillsResult = await client.query(
      `SELECT us.id, us.skill_id, s.name as skill_name, us.level 
       FROM user_skills us 
       JOIN skills s ON us.skill_id = s.id 
       WHERE us.user_id = $1 
       ORDER BY s.name`,
      [session.userId]
    );

    const allSkillsResult = await client.query(
      "SELECT id, name FROM skills ORDER BY name"
    );

    return res.json({
      userSkills: userSkillsResult.rows,
      availableSkills: allSkillsResult.rows,
    });
  } catch (error) {
    console.error("Error fetching skills:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/skills", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const { skill_id, level } = req.body;
  if (!skill_id || !level) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const validLevels = ["beginner", "intermediate", "advanced", "expert"];
  if (!validLevels.includes(level)) {
    return res.status(400).json({ message: "Invalid skill level" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const skillCheck = await client.query(
      "SELECT id FROM skills WHERE id = $1",
      [skill_id]
    );
    if (skillCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Skill not found" });
    }

    const existingSkill = await client.query(
      "SELECT id FROM user_skills WHERE user_id = $1 AND skill_id = $2",
      [session.userId, skill_id]
    );
    if (existingSkill.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Skill already added" });
    }

    await client.query(
      "INSERT INTO user_skills (user_id, skill_id, level) VALUES ($1, $2, $3)",
      [session.userId, skill_id, level]
    );

    await client.query("COMMIT");
    return res.json({ message: "Skill added successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error adding skill:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.put("/skills", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const { skill_id, level } = req.body;
  if (!skill_id || !level) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const validLevels = ["beginner", "intermediate", "advanced", "expert"];
  if (!validLevels.includes(level)) {
    return res.status(400).json({ message: "Invalid skill level" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updateResult = await client.query(
      "UPDATE user_skills SET level = $1, updated_at = NOW() WHERE user_id = $2 AND skill_id = $3",
      [level, session.userId, skill_id]
    );

    if (updateResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Skill not found" });
    }

    await client.query("COMMIT");
    return res.json({ message: "Skill level updated successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating skill:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.delete("/skills", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const { skill_id } = req.body;
  if (!skill_id) {
    return res.status(400).json({ message: "Missing skill ID" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const deleteResult = await client.query(
      "DELETE FROM user_skills WHERE user_id = $1 AND skill_id = $2",
      [session.userId, skill_id]
    );

    if (deleteResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Skill not found" });
    }

    await client.query("COMMIT");
    return res.json({ message: "Skill removed successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error removing skill:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.get("/preferences", async (req, res) => {
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userChannelsResult = await client.query(
      `SELECT uc.id, uc.channel_id, c.name as channel_name, c.description as channel_description, uc.preference_rank
       FROM user_channels uc
       JOIN channels c ON c.id = uc.channel_id
       WHERE uc.user_id = $1
       ORDER BY uc.preference_rank`,
      [userId]
    );

    const userLevelsResult = await client.query(
      `SELECT ul.id, ul.level_id, l.name as level_name, l.description as level_description, l.sort_order, ul.preference_rank
       FROM user_levels ul
       JOIN levels l ON l.id = ul.level_id
       WHERE ul.user_id = $1
       ORDER BY ul.preference_rank`,
      [userId]
    );

    const allChannelsResult = await client.query(
      `SELECT id, name, description
       FROM channels
       WHERE organisation_id = $1
       ORDER BY name`,
      [organisationId]
    );

    const allLevelsResult = await client.query(
      `SELECT id, name, description, sort_order
       FROM levels
       WHERE organisation_id = $1
       ORDER BY sort_order, name`,
      [organisationId]
    );

    await client.query("COMMIT");

    return res.json({
      userChannels: userChannelsResult.rows,
      userLevels: userLevelsResult.rows,
      availableChannels: allChannelsResult.rows,
      availableLevels: allLevelsResult.rows,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error fetching user preferences:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/preferences/channels", async (req, res) => {
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
  const { channel_id } = req.body;

  if (!channel_id) {
    return res.status(400).json({ message: "Channel ID is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const channelCheck = await client.query(
      "SELECT id FROM channels WHERE id = $1 AND organisation_id = $2",
      [channel_id, organisationId]
    );

    if (channelCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Invalid channel" });
    }

    const existingResult = await client.query(
      "SELECT id FROM user_channels WHERE user_id = $1 AND channel_id = $2",
      [userId, channel_id]
    );

    if (existingResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Channel preference already exists" });
    }

    const rankResult = await client.query(
      "SELECT COALESCE(MAX(preference_rank), 0) + 1 as next_rank FROM user_channels WHERE user_id = $1",
      [userId]
    );

    const nextRank = rankResult.rows[0].next_rank;

    await client.query(
      "INSERT INTO user_channels (user_id, channel_id, preference_rank) VALUES ($1, $2, $3)",
      [userId, channel_id, nextRank]
    );

    await client.query("COMMIT");
    return res.json({ message: "Channel preference added successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error adding channel preference:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/preferences/levels", async (req, res) => {
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
  const { level_id } = req.body;

  if (!level_id) {
    return res.status(400).json({ message: "Level ID is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const levelCheck = await client.query(
      "SELECT id FROM levels WHERE id = $1 AND organisation_id = $2",
      [level_id, organisationId]
    );

    if (levelCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Invalid level" });
    }

    const existingResult = await client.query(
      "SELECT id FROM user_levels WHERE user_id = $1 AND level_id = $2",
      [userId, level_id]
    );

    if (existingResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Level preference already exists" });
    }

    const rankResult = await client.query(
      "SELECT COALESCE(MAX(preference_rank), 0) + 1 as next_rank FROM user_levels WHERE user_id = $1",
      [userId]
    );

    const nextRank = rankResult.rows[0].next_rank;

    await client.query(
      "INSERT INTO user_levels (user_id, level_id, preference_rank) VALUES ($1, $2, $3)",
      [userId, level_id, nextRank]
    );

    await client.query("COMMIT");
    return res.json({ message: "Level preference added successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error adding level preference:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.delete("/preferences/channels", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const { channel_id } = req.body;

  if (!channel_id) {
    return res.status(400).json({ message: "Channel ID is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      "DELETE FROM user_channels WHERE user_id = $1 AND channel_id = $2",
      [userId, channel_id]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Channel preference not found" });
    }

    await client.query("COMMIT");
    return res.json({ message: "Channel preference removed successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error removing channel preference:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.delete("/preferences/levels", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const { level_id } = req.body;

  if (!level_id) {
    return res.status(400).json({ message: "Level ID is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      "DELETE FROM user_levels WHERE user_id = $1 AND level_id = $2",
      [userId, level_id]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Level preference not found" });
    }

    await client.query("COMMIT");
    return res.json({ message: "Level preference removed successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error removing level preference:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
