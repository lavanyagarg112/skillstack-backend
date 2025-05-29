// routes/courses.js
const express = require("express");
const pool = require("../database/db");
const router = express.Router();
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage });

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

// MODULES ENDPOINTS

router.post("/get-modules", async (req, res) => {
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

    const modulesRes = await client.query(
      `SELECT id, title, module_type, position FROM modules WHERE course_id = $1`,
      [courseId]
    );

    await client.query("COMMIT");
    return res.status(201).json({ modules: modulesRes.rows || [] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/add-module", upload.single("file"), async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });
  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }
  if (session.organisation?.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { courseId, name, type, description = "" } = req.body;
  const file = req.file;
  if (!courseId || !name || !type || !file) {
    return res
      .status(400)
      .json({ message: "courseId, title, moduleType & file required" });
  }
  const fileUrl = `/uploads/${req.file.filename}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const posRes = await client.query(
      `SELECT COALESCE(MAX(position), 0) AS max_pos
         FROM modules
         WHERE course_id = $1`,
      [courseId]
    );
    const nextPosition = posRes.rows[0].max_pos + 1;

    const moduleRes = await client.query(
      `INSERT INTO modules (course_id, title, module_type, description, position, file_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, title, module_type, position, file_url`,
      [courseId, name, type, description, nextPosition, fileUrl]
    );

    if (!moduleRes.rows.length) {
      throw new Error("Failed to create module");
    }

    const module_id = moduleRes.rows[0].id;

    await client.query("COMMIT");
    return res.status(201).json({
      module_id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.delete("/delete-module", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  if (session.organisation?.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { moduleId } = req.body;
  if (!moduleId) {
    return res.status(400).json({ message: "moduleId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const _ = await client.query(`DELETE FROM modules WHERE id = $1`, [
      moduleId,
    ]);

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

module.exports = router;
