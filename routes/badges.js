const express = require("express");
const pool = require("../database/db");
const router = express.Router();
const logActivity = require("./activityLogger");

router.post("/create-frequent", async (req, res) => {
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
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  const organisationRole = session.organisation?.role;
  if (organisationRole !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { name, description, numCoursesCompleted } = req.body;
  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  if (!numCoursesCompleted) {
    return res.status(400).json({
      message: "numCoursesCompleted is required",
    });
  }

  if (numCoursesCompleted < 0) {
    return res.status(400).json({
      message: "numCoursesCompleted must be non-negative",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO badges (name, description, num_courses_completed, organisation_id)
            VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, description || "", numCoursesCompleted, organisationId]
    );

    const badgeId = rows[0].id;

    await logActivity({
      userId,
      action: "create_badge",
      organisationId,
      metadata: {
        badgeId,
        name,
        description,
        numCoursesCompleted,
      },
      displayMetadata: {
        name,
        description,
        "Number of courses to be completed": numCoursesCompleted || 0,
      },
    });

    await client.query("COMMIT");
    res.status(201).json({ badgeId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating badge:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/create-specific-course", async (req, res) => {
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
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  const organisationRole = session.organisation?.role;
  if (organisationRole !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { name, description, courseId } = req.body;
  if (!name || !courseId) {
    return res.status(400).json({ message: "name and courseId are required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const courseRes = await client.query(
      `SELECT id, name FROM courses WHERE id = $1`,
      [courseId]
    );
    if (!courseRes.rows.length) {
      return res.status(404).json({ message: "Course not found" });
    }
    const courseName = courseRes.rows[0].name;

    const { rows } = await client.query(
      `INSERT INTO badges (name, description, organisation_id, course_id)
             VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, description || "", organisationId, courseId]
    );

    const badgeId = rows[0].id;

    await logActivity({
      userId,
      action: "create_badge",
      organisationId,
      metadata: { badgeId, name, description, courseId },
      displayMetadata: {
        "Course Name": courseName,
      },
    });

    await client.query("COMMIT");
    res.status(201).json({ badgeId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating badge:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.get("/created-badges", async (req, res) => {
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
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }
  const organisationRole = session.organisation?.role;
  if (organisationRole !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, name, description, num_courses_completed
             FROM badges
                WHERE organisation_id = $1
                AND num_courses_completed IS NOT NULL
                AND num_courses_completed > 0
                ORDER BY created_at DESC`,
      [organisationId]
    );
    const coursesBadges = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      numCoursesCompleted: row.num_courses_completed,
    }));

    const { rows: specificCourseBadges } = await client.query(
      `SELECT id, name, description, course_id
             FROM badges
             WHERE organisation_id = $1
             AND course_id IS NOT NULL
             ORDER BY created_at DESC`,
      [organisationId]
    );
    const courseBadges = specificCourseBadges.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      courseId: row.course_id,
    }));

    await client.release();
    return res.status(200).json({
      coursesBadges,
      courseBadges,
    });
  } catch (err) {
    await client.release();
    console.error("Error getting badges:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/user-badges", async (req, res) => {
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
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT b.id, b.name, b.description, ub.awarded_at
             FROM badges b, user_badges ub
             WHERE b.id = ub.badge_id
             AND b.organisation_id = $1 AND ub.user_id = $2
             ORDER BY ub.awarded_at DESC`,
      [organisationId, userId]
    );

    const badges = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      awardedAt: row.awarded_at ? new Date(row.awarded_at).toISOString() : null,
    }));

    await client.release();

    return res.json({ badges });
  } catch (err) {
    await client.release();
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.delete("/course-specific-badge", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const { badgeId } = req.body;
  if (!badgeId) {
    return res.status(400).json({ message: "badgeId is required" });
  }

  const userId = session.userId;
  const organisationId = session.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  const organisationRole = session.organisation?.role;
  if (organisationRole !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const badgeRes = await client.query(
      `SELECT * FROM badges WHERE id = $1 AND organisation_id = $2`,
      [badgeId, organisationId]
    );
    if (!badgeRes.rows.length) {
      return res.status(404).json({ message: "Badge not found" });
    }

    await client.query(
      `DELETE FROM badges WHERE id = $1 AND organisation_id = $2`,
      [badgeId, organisationId]
    );

    const badgeName = badgeRes.rows[0].name;

    await logActivity({
      userId,
      action: "delete_badge",
      organisationId,
      metadata: { badgeId },
      displayMetadata: { "Badge Name": badgeName },
    });

    await client.query("COMMIT");
    return res.status(200).json({ message: "Badge deleted successfully" });
  } catch (err) {
    await client.release();
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.delete("/frequent-badge", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const { badgeId } = req.body;
  if (!badgeId) {
    return res.status(400).json({ message: "badgeId is required" });
  }

  const userId = session.userId;
  const organisationId = session.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  const organisationRole = session.organisation?.role;
  if (organisationRole !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const badgeRes = await client.query(
      `SELECT * FROM badges WHERE id = $1 AND organisation_id = $2`,
      [badgeId, organisationId]
    );
    if (!badgeRes.rows.length) {
      return res.status(404).json({ message: "Badge not found" });
    }

    await client.query(
      `DELETE FROM badges WHERE id = $1 AND organisation_id = $2`,
      [badgeId, organisationId]
    );

    const badgeName = badgeRes.rows[0].name;

    await logActivity({
      userId,
      action: "delete_badge",
      organisationId,
      metadata: { badgeId },
      displayMetadata: { "Badge Name": badgeName },
    });

    await client.query("COMMIT");
    return res.status(200).json({ message: "Badge deleted successfully" });
  } catch (err) {
    await client.release();
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
