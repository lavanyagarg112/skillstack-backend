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
  const courseTags = req.body.tags || [];
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

    if (courseTags.length) {
      const courseId = courseRes.rows[0].id;
      for (const t of courseTags) {
        let tagId;

        if (typeof t === "number") {
          tagId = t;
        } else {
          const { rows } = await client.query(
            `INSERT INTO tags (name)
         VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
            [t]
          );
          tagId = rows[0].id;
        }

        // finally link course ↔ tag
        await client.query(
          `INSERT INTO course_tags (course_id, tag_id)
       VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
          [courseId, tagId]
        );
      }
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
      `
      SELECT
        c.id,
        c.name,
        c.description,
        -- aggregate tags into an array of { id, name }
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('id', t.id, 'name', t.name)
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'
        ) AS tags
      FROM courses c
      LEFT JOIN course_tags ct
        ON ct.course_id = c.id
      LEFT JOIN tags t
        ON t.id = ct.tag_id
      WHERE c.organisation_id = $1
      GROUP BY c.id, c.name, c.description
      ORDER BY c.name
      `,
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

    const tags = await client.query(
      `SELECT t.id, t.name FROM course_tags ct
      JOIN tags t ON ct.tag_id = t.id
      WHERE ct.course_id = $1`,
      [courseId]
    );

    await client.query("COMMIT");
    return res.status(200).json({
      id: courseRes.rows[0].id,
      name: courseRes.rows[0].name,
      description: courseRes.rows[0].description,
      tags: tags.rows || [],
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
  const courseTags = req.body.tags || [];
  const updateTags = req.body.updateTags || false;
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

    // const courseId = courseRes.rows[0].id;

    if (updateTags) {
      await client.query(`DELETE FROM course_tags WHERE course_id = $1`, [
        courseId,
      ]);

      if (courseTags.length) {
        for (const t of courseTags) {
          let tagId;
          if (typeof t === "number") {
            tagId = t;
          } else {
            const { rows } = await client.query(
              `INSERT INTO tags (name)
         VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
              [t]
            );
            tagId = rows[0].id;
          }

          // finally link course ↔ tag
          await client.query(
            `INSERT INTO course_tags (course_id, tag_id)
       VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
            [courseId, tagId]
          );
        }
      }
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
      `
  SELECT
    m.id,
    m.title,
    m.module_type,
    m.position,
    COALESCE(
      JSON_AGG(
        JSON_BUILD_OBJECT('id', t.id, 'name', t.name)
      ) FILTER (WHERE t.id IS NOT NULL),
      '[]'
    ) AS tags
  FROM modules m
  LEFT JOIN module_tags mt
    ON mt.module_id = m.id
  LEFT JOIN tags t
    ON t.id = mt.tag_id
  WHERE m.course_id = $1
  GROUP BY m.id
  ORDER BY m.position
  `,
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
  let moduleTags = req.body.moduleTags || [];
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

  if (typeof moduleTags === "string") {
    moduleTags = JSON.parse(moduleTags);
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

    if (moduleTags && moduleTags.length) {
      for (const t of moduleTags) {
        let tagId;

        if (!t.isNew) {
          tagId = t.id;
        } else {
          const { rows } = await client.query(
            `INSERT INTO tags (name)
         VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
            [t.name]
          );
          tagId = rows[0].id;
        }

        // finally link course ↔ tag
        await client.query(
          `INSERT INTO module_tags (module_id, tag_id)
       VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
          [module_id, tagId]
        );
      }
    }

    const { rows: enrollments } = await client.query(
      `SELECT id
     FROM enrollments
    WHERE course_id = $1`,
      [courseId]
    );

    for (const { id: enrollmentId } of enrollments) {
      await client.query(
        `INSERT INTO module_status
       (enrollment_id, module_id, status)
     VALUES ($1, $2, 'not_started')
     ON CONFLICT (enrollment_id, module_id) DO NOTHING`,
        [enrollmentId, module_id]
      );
    }

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

    const moduleTagsRes = await client.query(
      `SELECT tag_id, t.name AS tag_name
         FROM module_tags mt
         JOIN tags t ON mt.tag_id = t.id
        WHERE mt.module_id = $1`,
      [moduleId]
    );

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
              `SELECT id, question_id, option_text, is_correct
                 FROM question_options
                WHERE question_id = ANY($1)`,
              [questionIds]
            );
          }

          const questions = questionsRes.rows.map((q) => ({
            id: q.id,
            question_text: q.question_text,
            question_type: q.question_type,
            options: optionsRes.rows
              .filter((opt) => opt.question_id === q.id)
              .map((opt) => ({
                id: opt.id,
                option_text: opt.option_text,
                is_correct: opt.is_correct,
              })),
          }));

          module.quiz = {
            id: quiz.id,
            quiz_type: quiz.quiz_type,
            questions,
          };
          module.file_url = null; // quiz modules don't have file_url
        }
      }
    }

    module.tags = moduleTagsRes.rows.map((r) => ({
      id: r.tag_id,
      name: r.tag_name,
    }));

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

  const {
    moduleId,
    name,
    description = "",
    type,
    questions,
    updateTags = false,
  } = req.body;

  let moduleTags = req.body.moduleTags || [];

  if (!moduleId || !name) {
    return res
      .status(400)
      .json({ message: "moduleId, name and type are required" });
  }

  if (typeof moduleTags === "string") {
    moduleTags = JSON.parse(moduleTags);
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

    if (updateTags) {
      await client.query(
        `DELETE FROM module_tags
         WHERE module_id = $1`,
        [moduleId]
      );
      if (moduleTags && moduleTags.length) {
        for (const t of moduleTags) {
          let tagId;

          if (!t.isNew) {
            tagId = t.id;
          } else {
            const { rows } = await client.query(
              `INSERT INTO tags (name)
         VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
              [t.name]
            );
            tagId = rows[0].id;
          }

          // finally link course ↔ tag
          await client.query(
            `INSERT INTO module_tags (module_id, tag_id)
       VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
            [moduleId, tagId]
          );
        }
      }
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

      await client.query(
        `DELETE FROM quiz_responses
       WHERE quiz_id = $1`,
        [quizId]
      );

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

    if (type) {
      const courseIdRes = await client.query(
        `SELECT course_id FROM modules WHERE id = $1`,
        [moduleId]
      );

      if (!courseIdRes.rows.length) {
        return res.status(404).json({ message: "Module not found" });
      }
      const courseId = courseIdRes.rows[0].course_id;

      const { rows: enrollments } = await client.query(
        `SELECT id
      FROM enrollments
      WHERE course_id = $1`,
        [courseId]
      );

      for (const { id: enrollmentId } of enrollments) {
        await client.query(
          `UPDATE module_status
             SET status = 'not_started'
           WHERE enrollment_id = $1 AND module_id = $2`,
          [enrollmentId, moduleId]
        );
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

router.get("/all-user-courses", async (req, res) => {
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
    return res.status(400).json({ message: "Organisation context missing" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) “Enrolled” courses (status = 'enrolled')
    const enrolledRes = await client.query(
      `
      SELECT
        c.id,
        c.name,
        c.description,
        COUNT(m.id)                             AS total_modules,
        COUNT(ms.id) FILTER (WHERE ms.status = 'completed')
                                                AS completed_modules,
      COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('id', t.id, 'name', t.name)
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'
        ) AS tags
      FROM courses c
        JOIN enrollments e
          ON e.course_id = c.id
        AND e.user_id   = $1
        AND e.status    = 'enrolled'
        LEFT JOIN modules m
          ON m.course_id = c.id
        LEFT JOIN course_tags ct
        ON ct.course_id = c.id
        LEFT JOIN tags t
          ON t.id = ct.tag_id
        LEFT JOIN module_status ms
          ON ms.module_id     = m.id
        AND ms.enrollment_id = e.id
      GROUP BY c.id, c.name, c.description;
      `,
      [userId]
    );

    // 2) “Completed” courses (status = 'completed')
    const completedRes = await client.query(
      `
      SELECT
        c.id,
        c.name,
        c.description,
        COUNT(m.id)                             AS total_modules,
        COUNT(ms.id) FILTER (WHERE ms.status = 'completed')
                                                AS completed_modules,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('id', t.id, 'name', t.name)
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'
        ) AS tagss
      FROM courses c
        JOIN enrollments e
          ON e.course_id = c.id
        AND e.user_id   = $1
        AND e.status    = 'completed'
        LEFT JOIN course_tags ct
        ON ct.course_id = c.id
        LEFT JOIN tags t
          ON t.id = ct.tag_id
        LEFT JOIN modules m
          ON m.course_id = c.id
        LEFT JOIN module_status ms
          ON ms.module_id     = m.id
        AND ms.enrollment_id = e.id
      GROUP BY c.id, c.name, c.description;
      `,
      [userId]
    );

    // 3) Others in same org, not enrolled at all
    const otherRes = await client.query(
      `
      SELECT c.id, c.name, c.description,
      COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('id', t.id, 'name', t.name)
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'
        ) AS tags
      FROM courses c
      LEFT JOIN course_tags ct
        ON ct.course_id = c.id
      LEFT JOIN tags t
        ON t.id = ct.tag_id
      WHERE c.organisation_id = $1
        AND c.id NOT IN (
          SELECT course_id
          FROM enrollments
          WHERE user_id = $2
        )
        GROUP BY c.id, c.name, c.description
      `,
      [organisationId, userId]
    );

    await client.query("COMMIT");
    return res.status(200).json({
      enrolled: enrolledRes.rows,
      completed: completedRes.rows,
      other: otherRes.rows,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in all-user-courses:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/enroll-course", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const { courseId } = req.body;
  if (!courseId) {
    return res.status(400).json({ message: "courseId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertRes = await client.query(
      `INSERT INTO enrollments (user_id, course_id, started_at)
         VALUES ($1, $2, NOW())
       RETURNING id, status, started_at`,
      [userId, courseId]
    );

    const enrollmentId = insertRes.rows[0].id;

    const modulesRes = await client.query(
      `SELECT id
         FROM modules
        WHERE course_id = $1`,
      [courseId]
    );

    for (const { id: moduleId } of modulesRes.rows) {
      await client.query(
        `INSERT INTO module_status
           (enrollment_id, module_id, status)
         VALUES ($1, $2, 'not_started')
         ON CONFLICT (enrollment_id, module_id) DO NOTHING`,
        [enrollmentId, moduleId]
      );
    }

    await client.query("COMMIT");
    return res.status(201).json({
      success: true,
      enrollment: insertRes.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    // if the user is already enrolled, unique constraint violation
    if (err.code === "23505") {
      return res
        .status(400)
        .json({ message: "Already enrolled in this course" });
    }
    console.error("Error enrolling user:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/unenroll-course", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const { courseId } = req.body;
  if (!courseId) {
    return res.status(400).json({ message: "courseId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const delRes = await client.query(
      `DELETE FROM enrollments
         WHERE user_id = $1
           AND course_id = $2
       RETURNING id`,
      [userId, courseId]
    );

    if (!delRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Not enrolled in this course" });
    }

    const enrollmentId = delRes.rows[0].id;

    await client.query(
      `DELETE FROM module_status
         WHERE enrollment_id = $1`,
      [enrollmentId]
    );

    await client.query(
      `DELETE FROM quiz_responses
         WHERE user_id = $1
           AND quiz_id IN (
             SELECT id FROM quizzes WHERE revision_id IN (
               SELECT id FROM revisions WHERE module_id IN (
                 SELECT id FROM modules WHERE course_id = $2
               )
             )
           )`,
      [userId, courseId]
    );

    await client.query("COMMIT");
    return res.status(200).json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error unenrolling user:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/complete-course", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const { courseId } = req.body;
  if (!courseId) {
    return res.status(400).json({ message: "courseId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const modRes = await client.query(
      `SELECT COUNT(*) AS total_modules,
              SUM(CASE WHEN ms.status = 'completed' THEN 1 ELSE 0 END) AS completed_modules
         FROM modules m
         JOIN module_status ms ON ms.module_id = m.id
        WHERE m.course_id = $1
          AND ms.enrollment_id = (  
            SELECT id FROM enrollments WHERE user_id = $2 AND course_id = $1
          )`,
      [courseId, userId]
    );

    const totalModules = modRes.rows[0].total_modules;
    const completedModules = modRes.rows[0].completed_modules;
    if (totalModules !== completedModules) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "Cannot complete course - not all modules are completed",
      });
    }

    await client.query(
      `UPDATE enrollments
         SET status = 'completed',
             completed_at = NOW()
       WHERE user_id = $1
         AND course_id = $2`,
      [userId, courseId]
    );

    await client.query("COMMIT");
    return res.status(200).json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error completing course:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/uncomplete-course", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const { courseId } = req.body;
  if (!courseId) {
    return res.status(400).json({ message: "courseId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE enrollments
         SET status = 'enrolled',
             completed_at = NULL
       WHERE user_id = $1
         AND course_id = $2`,
      [userId, courseId]
    );

    await client.query("COMMIT");
    return res.status(200).json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error completing course:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/is-enrolled", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const isOrganisationAdmin = session.organisation?.role === "admin";

  if (isOrganisationAdmin) {
    return res.status(200).json({
      enrolled: true,
    });
  }

  const { courseId } = req.body;
  if (!courseId) {
    return res.status(400).json({ message: "courseId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const enrollRes = await client.query(
      `SELECT 1 FROM enrollments
         WHERE user_id = $1
           AND course_id = $2
         LIMIT 1`,
      [userId, courseId]
    );

    await client.query("COMMIT");
    return res.status(200).json({
      enrolled: enrollRes.rows.length > 0,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error checking enrollment:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

// helper
async function submitQuizResponse(client, userId, quizId, answers) {
  const respRes = await client.query(
    `INSERT INTO quiz_responses (user_id, quiz_id)
       VALUES ($1, $2)
     RETURNING id`,
    [userId, quizId]
  );
  const responseId = respRes.rows[0].id;

  for (const ans of answers) {
    const { questionId, selectedOptionIds } = ans;
    if (!questionId || !Array.isArray(selectedOptionIds)) {
      throw new Error(
        "Each answer must have questionId and selectedOptionIds[]"
      );
    }
    for (const optId of selectedOptionIds) {
      await client.query(
        `INSERT INTO quiz_answers
           (response_id, question_id, selected_option_id)
         VALUES ($1, $2, $3)`,
        [responseId, questionId, optId]
      );
    }
  }

  const revisionRes = await client.query(
    `SELECT revision_id
       FROM quizzes
      WHERE id = $1`,
    [quizId]
  );

  const revisionId = revisionRes.rows[0].revision_id;

  const moduleRes = await client.query(
    `SELECT module_id
       FROM revisions
      WHERE id = $1`,
    [revisionId]
  );

  const moduleId = moduleRes.rows[0].module_id;

  const enrollmentRes = await client.query(
    `SELECT id
       FROM enrollments
      WHERE user_id = $1 AND course_id = (
        SELECT course_id FROM modules WHERE id = $2
      )`,
    [userId, moduleId]
  );

  const enrollmentId = enrollmentRes.rows[0].id;

  await client.query(
    `UPDATE module_status
       SET status = 'completed',
           completed_at = NOW()
     WHERE enrollment_id = $1 AND module_id = $2`,
    [enrollmentId, moduleId]
  );

  return responseId;
}

// helper
async function gradeQuizResponse(client, responseId) {
  const userAnsRes = await client.query(
    `SELECT question_id,
            ARRAY_AGG(selected_option_id) AS selected_option_ids
       FROM quiz_answers
      WHERE response_id = $1
      GROUP BY question_id`,
    [responseId]
  );
  const userAnswers = userAnsRes.rows;
  const questionIds = userAnswers.map((r) => r.question_id);

  const correctMap = {};
  if (questionIds.length) {
    const correctRes = await client.query(
      `SELECT question_id,
              ARRAY_AGG(id) AS correct_option_ids
         FROM question_options
        WHERE question_id = ANY($1) AND is_correct = TRUE
        GROUP BY question_id`,
      [questionIds]
    );
    for (const row of correctRes.rows) {
      correctMap[row.question_id] = row.correct_option_ids;
    }
  }

  const optionTextMap = {};
  if (questionIds.length) {
    const optsRes = await client.query(
      `SELECT id, option_text
         FROM question_options
        WHERE question_id = ANY($1)`,
      [questionIds]
    );
    for (const { id, option_text } of optsRes.rows) {
      optionTextMap[id] = option_text;
    }
  }

  return userAnswers.map(({ question_id, selected_option_ids }) => {
    const correctIds = correctMap[question_id] || [];
    const selectedIds = selected_option_ids || [];

    const correctOptions = correctIds.map((id) => ({
      id,
      text: optionTextMap[id] || "",
    }));
    const selectedOptions = selectedIds.map((id) => ({
      id,
      text: optionTextMap[id] || "",
    }));

    const isCorrect =
      correctIds.length === selectedIds.length &&
      correctIds.every((id) => selectedIds.includes(id));

    return {
      questionId: question_id,
      correctOptions,
      selectedOptions,
      isCorrect,
    };
  });
}

router.post("/submit-quiz", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });
  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }
  const { quizId, answers } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const responseId = await submitQuizResponse(
      client,
      userId,
      quizId,
      answers
    );
    await client.query("COMMIT");
    return res.status(201).json({ success: true, responseId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/grade-quiz", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });
  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }
  const { responseId } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const results = await gradeQuizResponse(client, responseId);
    await client.query("COMMIT");
    return res.status(200).json({ results });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/submit-and-grade-quiz", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });
  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }
  const userId = session.userId;

  const { quizId, answers } = req.body;
  if (!quizId || !Array.isArray(answers)) {
    return res.status(400).json({ message: "quizId and answers[] required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const responseId = await submitQuizResponse(
      client,
      userId,
      quizId,
      answers
    );
    const results = await gradeQuizResponse(client, responseId);
    await client.query("COMMIT");
    return res.status(200).json({ responseId, results });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in submit-and-grade-quiz:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/get-latest-quiz-response", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });
  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }
  const userId = session.userId;

  const { quizId } = req.body;
  if (!quizId) {
    return res.status(400).json({ message: "quizId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const respRes = await client.query(
      `SELECT id
         FROM quiz_responses
        WHERE user_id = $1
          AND quiz_id = $2
        ORDER BY submitted_at DESC
        LIMIT 1`,
      [userId, quizId]
    );
    if (!respRes.rows.length) {
      await client.query("COMMIT");
      return res.status(200).json({ responseId: null, results: null });
    }

    const responseId = respRes.rows[0].id;

    const results = await gradeQuizResponse(client, responseId);

    await client.query("COMMIT");
    return res.status(200).json({ responseId, results });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error fetching & grading quiz:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/get-module-status", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const moduleId = req.body.moduleId;
  if (!moduleId) {
    return res.status(400).json({ message: "moduleId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const courseIdRes = await client.query(
      `SELECT course_id FROM modules WHERE id = $1`,
      [moduleId]
    );

    const courseId = courseIdRes.rows[0]?.course_id;

    const enrolmentRes = await client.query(
      `SELECT id FROM enrollments
         WHERE user_id = $1 AND course_id = $2`,
      [userId, courseId]
    );

    const enrollmentId = enrolmentRes.rows[0]?.id;

    const isCourseCompleted = await client.query(
      `SELECT 1 FROM enrollments
         WHERE id = $1 AND status = 'completed'`,
      [enrollmentId]
    );

    const statusRes = await client.query(
      `SELECT status FROM module_status
         WHERE enrollment_id = $1 AND module_id = $2`,
      [enrollmentId, moduleId]
    );

    await client.query("COMMIT");
    return res.status(200).json({
      status: statusRes.rows.length ? statusRes.rows[0].status : "not_started",
      isCourseCompleted: isCourseCompleted.rows.length > 0,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/mark-module-started", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const moduleId = req.body.moduleId;
  if (!moduleId) {
    return res.status(400).json({ message: "moduleId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const courseIdRes = await client.query(
      `SELECT course_id FROM modules WHERE id = $1`,
      [moduleId]
    );

    const courseId = courseIdRes.rows[0]?.course_id;

    const enrolmentRes = await client.query(
      `SELECT id FROM enrollments
         WHERE user_id = $1 AND course_id = $2`,
      [userId, courseId]
    );

    const enrollmentId = enrolmentRes.rows[0]?.id;

    const statusRes = await client.query(
      `SELECT status FROM module_status
         WHERE enrollment_id = $1 AND module_id = $2`,
      [enrollmentId, moduleId]
    );

    await client.query(
      `UPDATE module_status
         SET status = 'in_progress',
              started_at = NOW()
         WHERE enrollment_id = $1 AND module_id = $2`,
      [enrollmentId, moduleId]
    );

    await client.query("COMMIT");
    return res.status(200).json({ status: "in_progress" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/mark-module-completed", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const moduleId = req.body.moduleId;
  if (!moduleId) {
    return res.status(400).json({ message: "moduleId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const courseIdRes = await client.query(
      `SELECT course_id FROM modules WHERE id = $1`,
      [moduleId]
    );

    const courseId = courseIdRes.rows[0]?.course_id;

    const enrolmentRes = await client.query(
      `SELECT id FROM enrollments
         WHERE user_id = $1 AND course_id = $2`,
      [userId, courseId]
    );

    const enrollmentId = enrolmentRes.rows[0]?.id;

    const statusRes = await client.query(
      `SELECT status FROM module_status
         WHERE enrollment_id = $1 AND module_id = $2`,
      [enrollmentId, moduleId]
    );

    if (statusRes.rows.length && statusRes.rows[0].status !== "in_progress") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "Module must be marked as in_progress before completing",
      });
    }

    await client.query(
      `UPDATE module_status
         SET status = 'completed',
            completed_at = NOW()
         WHERE enrollment_id = $1 AND module_id = $2`,
      [enrollmentId, moduleId]
    );

    await client.query("COMMIT");
    return res.status(200).json({ status: "in_progress" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.post("/add-tags", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session data" });
  }

  const userId = session.userId;
  const isAdmin = session.organisation?.role === "admin";
  if (!isAdmin) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const { tags } = req.body;
  if (!Array.isArray(tags)) {
    return res.status(400).json({ message: "tags[] are required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const tag of tags) {
      if (!tag.name) {
        continue; // skip if tag has no name
      }
      await client.query(
        `INSERT INTO tags (name)
         VALUES ($1)
         ON CONFLICT (name) DO NOTHING`,
        [tag.name]
      );
    }
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

router.get("/tags", async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, name FROM tags ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
