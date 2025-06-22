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
  const organisationId = session.organisation?.id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const courseRes = await client.query(
      `SELECT c.id, c.name, c.description FROM courses c
      WHERE c.organisation_id = $1`,
      [organisationId]
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

  const { courseId, name, type, description = "", questions } = req.body;
  if (!courseId || !name || !type) {
    return res
      .status(400)
      .json({ message: "courseId, name and type are required" });
  }
  if (type === "quiz" && !questions) {
    return res
      .status(400)
      .json({ message: "questions JSON is required for quiz modules" });
  }
  if (type !== "quiz" && !req.file) {
    return res
      .status(400)
      .json({ message: "file is required for non-quiz modules" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;

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

    if (type === "quiz") {
      // revision for this module
      const revRes = await client.query(
        `INSERT INTO revisions (module_id, revision_number)
           VALUES ($1,
                   COALESCE((SELECT MAX(revision_number) FROM revisions WHERE module_id=$1), 0) + 1
                  )
           RETURNING id`,
        [module_id]
      );
      const revisionId = revRes.rows[0].id;

      // 4) Create the quiz record
      const quizRes = await client.query(
        `INSERT INTO quizzes (revision_id, title, quiz_type)
           VALUES ($1,$2,$3)
           RETURNING id`,
        [revisionId, name, "practice"]
      );
      const quizId = quizRes.rows[0].id;

      // 5) Insert questions + options
      const qs = JSON.parse(questions);
      for (let i = 0; i < qs.length; i++) {
        const { question_text, question_type, options } = qs[i];
        const qRes = await client.query(
          `INSERT INTO questions
               (quiz_id, question_text, question_type, position)
             VALUES ($1,$2,$3,$4)
             RETURNING id`,
          [quizId, question_text, question_type, i]
        );
        const questionId = qRes.rows[0].id;

        for (let opt of options) {
          await client.query(
            `INSERT INTO question_options
                 (question_id, option_text, is_correct)
               VALUES ($1,$2,$3)`,
            [questionId, opt.option_text, opt.is_correct]
          );
        }
      }
    }

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

router.post("/get-module", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const moduleId = req.body.moduleId;
  if (!moduleId) {
    return res.status(400).json({ message: "moduleId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const moduleRes = await client.query(
      `SELECT id, title, module_type, description, file_url
         FROM modules WHERE id = $1`,
      [moduleId]
    );

    if (!moduleRes.rows.length) {
      console.error("Module not found for ID:", moduleId);
      return res.status(404).json({ message: "Module not found" });
    }

    const module = moduleRes.rows[0];

    if (module.module_type === "quiz") {
      // 2a) get the latest revision
      const revRes = await client.query(
        `SELECT id
           FROM revisions
          WHERE module_id = $1
          ORDER BY revision_number DESC
          LIMIT 1`,
        [moduleId]
      );

      if (revRes.rows.length) {
        const revisionId = revRes.rows[0].id;

        const quizRes = await client.query(
          `SELECT id, quiz_type
             FROM quizzes
            WHERE revision_id = $1`,
          [revisionId]
        );

        if (quizRes.rows.length) {
          const quiz = quizRes.rows[0];

          const questionsRes = await client.query(
            `SELECT id, question_text, question_type, position
               FROM questions
              WHERE quiz_id = $1
              ORDER BY position`,
            [quiz.id]
          );

          const questionIds = questionsRes.rows.map((q) => q.id);
          let optionsRes = { rows: [] };
          if (questionIds.length) {
            optionsRes = await client.query(
              `SELECT question_id, option_text, is_correct
                 FROM question_options
                WHERE question_id = ANY($1)`,
              [questionIds]
            );
          }

          const questions = questionsRes.rows.map((q) => ({
            question_text: q.question_text,
            question_type: q.question_type,
            options: optionsRes.rows
              .filter((opt) => opt.question_id === q.id)
              .map((opt) => ({
                option_text: opt.option_text,
                is_correct: opt.is_correct,
              })),
          }));

          module.quiz = {
            quiz_type: quiz.quiz_type,
            questions,
          };
          module.file_url = null; // quiz modules don't have file_url
        }
      }
    }

    await client.query("COMMIT");
    return res.status(200).json(module);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.put("/update-module", upload.single("file"), async (req, res) => {
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

  const { moduleId, name, description = "", type, questions } = req.body;

  if (!moduleId || !name) {
    return res
      .status(400)
      .json({ message: "moduleId, name and type are required" });
  }

  const file = req.file; // may be undefined for quiz
  const fileUrl = file ? `/uploads/${file.filename}` : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (fileUrl) {
      await client.query(
        `UPDATE modules
             SET title       = $1,
                 description = $2,
                 module_type = $3,
                 file_url    = $4
           WHERE id = $5`,
        [name, description, type, fileUrl, moduleId]
      );
    } else {
      await client.query(
        `UPDATE modules
             SET title       = $1,
                 description = $2
           WHERE id = $3`,
        [name, description, moduleId]
      );
    }

    const orignalTypeRes = await client.query(
      `SELECT module_type FROM modules WHERE id = $1`,
      [moduleId]
    );
    const originalType = orignalTypeRes.rows[0].module_type;

    if (!type && originalType === "quiz") {
      const revRes = await client.query(
        `SELECT id
       FROM revisions
      WHERE module_id = $1
      ORDER BY revision_number DESC
      LIMIT 1`,
        [moduleId]
      );
      if (!revRes.rows.length) {
        return res.status(404).json({ message: "Revision not found" });
      }
      const revisionId = revRes.rows[0].id;

      const quizRes = await client.query(
        `SELECT id FROM quizzes WHERE revision_id = $1`,
        [revisionId]
      );
      if (!quizRes.rows.length) {
        return res.status(404).json({ message: "Quiz not found" });
      }
      await client.query(
        `UPDATE quizzes 
              SET revision_id = $1, title = $2, quiz_type = $3
            WHERE id = $4`,
        [revisionId, name, "practice", quizRes.rows[0].id]
      );
    }

    if (type === "quiz" && questions) {
      let qs;
      try {
        qs = JSON.parse(questions);
        if (!Array.isArray(qs)) throw new Error();
      } catch {
        return res
          .status(400)
          .json({ message: "Invalid JSON in `questions` field" });
      }

      const revRes = await client.query(
        `SELECT id
       FROM revisions
      WHERE module_id = $1
      ORDER BY revision_number DESC
      LIMIT 1`,
        [moduleId]
      );
      const revisionId = revRes.rows.length
        ? revRes.rows[0].id
        : (
            await client.query(
              `INSERT INTO revisions (module_id, revision_number)
           VALUES ($1, 1)
         RETURNING id`,
              [moduleId]
            )
          ).rows[0].id;

      const quizRes = await client.query(
        `SELECT id FROM quizzes WHERE revision_id = $1`,
        [revisionId]
      );
      const quizId = quizRes.rows.length
        ? (
            await client.query(
              `UPDATE quizzes 
              SET revision_id = $1, title = $2, quiz_type = $3
            WHERE id = $4
            RETURNING id`,
              [revisionId, name, "practice", quizRes.rows[0].id]
            )
          ).rows[0].id
        : (
            await client.query(
              `INSERT INTO quizzes (revision_id, title, quiz_type)
           VALUES ($1, $2, $3)
         RETURNING id`,
              [revisionId, name, "practice"]
            )
          ).rows[0].id;

      await client.query(
        `DELETE FROM question_options
       WHERE question_id IN (
         SELECT id FROM questions WHERE quiz_id = $1
       )`,
        [quizId]
      );
      await client.query(`DELETE FROM questions WHERE quiz_id = $1`, [quizId]);

      for (let i = 0; i < qs.length; i++) {
        const { question_text, question_type, options } = qs[i];
        const qRes = await client.query(
          `INSERT INTO questions
         (quiz_id, question_text, question_type, position)
       VALUES ($1, $2, $3, $4)
     RETURNING id`,
          [quizId, question_text, question_type, i]
        );
        const questionId = qRes.rows[0].id;

        for (let opt of options) {
          await client.query(
            `INSERT INTO question_options
           (question_id, option_text, is_correct)
         VALUES ($1, $2, $3)`,
            [questionId, opt.option_text, opt.is_correct]
          );
        }
      }
    }

    await client.query("COMMIT");
    return res.status(200).json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in update-module:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});
module.exports = router;
