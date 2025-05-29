// routes/courses.js
const express = require("express");
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
  const organisationId = session.organisation?.id;
  const organisationRole = session.organisation?.role;
  if (organisationRole !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  const courseName = req.body.courseName;
  const courseDescription = req.body.description || "";
  if (!courseName) {
    return res.status(400).json({ message: "courseName is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const courseRes = await client.query(
      `INSERT INTO courses (organisation_id, name, description, created_by )
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, created_at`,
      [organisationId, courseName, courseDescription, userId]
    );

    if (!courseRes.rows.length) {
      throw new Error("Failed to create course");
    }

    await client.query("COMMIT");
    return res.status(201).json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    if (err.code === "23505") {
      return res.status(400).json({ message: "Course name already taken" });
    }
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.get("/", async (req, res) => {
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

    const courseRes = await client.query(
      `SELECT c.id, c.name, c.description FROM courses c
      WHERE c.organisation_id = $1
      AND c.created_by = $2`,
      [organisationId, userId]
    );

    await client.query("COMMIT");
    return res.status(201).json({ courses: courseRes.rows });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/get-course", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const courseId = req.body.courseId;
  if (!courseId) {
    return res.status(400).json({ message: "courseId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const courseRes = await client.query(
      `SELECT c.id, c.name, c.description FROM courses c
      WHERE c.id = $1`,
      [courseId]
    );

    if (!courseRes.rows.length) {
      console.error("Course not found for ID:", courseId);
      return res.status(404).json({ message: "Course not found" });
    }

    await client.query("COMMIT");
    return res.status(200).json({
      id: courseRes.rows[0].id,
      name: courseRes.rows[0].name,
      description: courseRes.rows[0].description,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
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
  const courseId = req.body.courseId;
  if (!courseId) {
    return res.status(400).json({ message: "courseId is required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const _ = await client.query(
      `DELETE FROM courses c
      WHERE c.id = $1`,
      [courseId]
    );

    await client.query("COMMIT");
    return res.status(201).json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.put("/", async (req, res) => {
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

  const courseId = req.body.courseId;
  const courseName = req.body.courseName;
  const courseDescription = req.body.description || "";
  if (!courseId || !courseName) {
    return res
      .status(400)
      .json({ message: "courseId and courseName are required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const courseRes = await client.query(
      `UPDATE courses
         SET name = $1,
              description = $2
       WHERE id = $3
       RETURNING id, name, description`,
      [courseName, courseDescription, courseId]
    );

    if (!courseRes.rows.length) {
      throw new Error("Failed to update course");
    }

    await client.query("COMMIT");
    return res.status(201).json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    if (err.code === "23505") {
      return res.status(400).json({ message: "Course name already taken" });
    }
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
