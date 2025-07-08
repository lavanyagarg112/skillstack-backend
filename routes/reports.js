const express = require("express");
const pool = require("../database/db");
const router = express.Router();
const multer = require("multer");
const path = require("path");

router.get("/progress", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });

  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session" });
  }

  const userId = session.userId;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1) Courses done
    const { rows: coursesDone } = await client.query(
      `SELECT c.id, c.name, e.completed_at
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
        WHERE e.user_id = $1
          AND e.status = 'completed'
      `,
      [userId]
    );

    // 2) Modules done
    const { rows: modCount } = await client.query(
      `SELECT COUNT(*) AS modules_done
         FROM module_status ms
        JOIN enrollments e ON e.id = ms.enrollment_id
        WHERE e.user_id = $1
          AND ms.status = 'completed'
      `,
      [userId]
    );
    const modulesDone = parseInt(modCount[0].modules_done, 10);

    // 3) Quiz results (latest per quiz)
    const { rows: quizResults } = await client.query(
      `WITH latest AS (
         SELECT DISTINCT ON (qr.quiz_id)
                qr.id AS response_id,
                qr.quiz_id,
                qr.submitted_at
           FROM quiz_responses qr
          WHERE qr.user_id = $1
          ORDER BY qr.quiz_id, qr.submitted_at DESC
       ),
       answers AS (
         SELECT l.quiz_id,
                COUNT(*) FILTER (WHERE qo.is_correct AND qa.selected_option_id = qo.id)      AS correct,
                COUNT(*)                                                               AS total,
                l.submitted_at,
                qz.title
           FROM latest l
           JOIN quiz_answers qa ON qa.response_id = l.response_id
           JOIN question_options qo ON qo.id = qa.selected_option_id
           JOIN quizzes qz ON qz.id = l.quiz_id
          GROUP BY l.quiz_id, l.submitted_at, qz.title
       )
       SELECT quiz_id, title, correct, total,
              ROUND(correct::decimal * 100 / NULLIF(total,0),1) AS score_pct,
              submitted_at AS taken_at
         FROM answers
      `,
      [userId]
    );

    // Strengths & weaknesses by tag
    const { rows: tagPerf } = await client.query(
      `WITH latest AS (
  SELECT DISTINCT ON (qr.quiz_id)
         qr.id        AS response_id,
         qr.quiz_id
    FROM quiz_responses qr
   WHERE qr.user_id = $1
   ORDER BY qr.quiz_id, qr.submitted_at DESC
),
user_ans AS (
  SELECT
    mt.tag_id,
    t.name       AS tag_name,
    CASE WHEN qo.is_correct THEN 1 ELSE 0 END AS is_correct
  FROM latest l
  -- each answered option
  JOIN quiz_answers qa      ON qa.response_id = l.response_id
  JOIN question_options qo ON qo.id = qa.selected_option_id

  -- find the module that backs this quiz
  JOIN quizzes q           ON q.id = l.quiz_id
  JOIN revisions r         ON r.id = q.revision_id
  JOIN module_tags mt      ON mt.module_id = r.module_id
  JOIN tags t              ON t.id = mt.tag_id
)
SELECT
  tag_name,
  SUM(is_correct)                AS correct,
  COUNT(*)                       AS total,
  ROUND(SUM(is_correct)::decimal * 100 / NULLIF(COUNT(*),0), 1) AS pct
FROM user_ans
GROUP BY tag_name

      `,
      [userId]
    );

    const strengths = tagPerf.filter((r) => r.pct >= 80);
    const weaknesses = tagPerf.filter((r) => r.pct < 80);

    await client.query("COMMIT");
    return res.json({
      coursesDone,
      modulesDone,
      quizResults,
      strengths,
      weaknesses,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Progress report error:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

async function requireAdmin(req, res, next) {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });
  let session;
  try {
    session = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session" });
  }
  if (session.organisation?.role !== "admin")
    return res.status(403).json({ message: "Forbidden" });
  req.orgId = session.organisation.id;
  next();
}

router.get("/overview", requireAdmin, async (req, res) => {
  const orgId = req.orgId;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const coursesRes = await client.query(
      `
      SELECT
        c.id,
        c.name,
        COUNT(e.*) FILTER (WHERE e.status IN ('enrolled','completed')) AS total_enrolled,
        COUNT(e.*) FILTER (WHERE e.status = 'completed')              AS total_completed,
        COUNT(m.*) FILTER (WHERE m.module_type = 'video')            AS videos,
        COUNT(m.*) FILTER (WHERE m.module_type = 'quiz')             AS quizzes,
        COUNT(m.*) FILTER (WHERE m.module_type = 'pdf')              AS pdfs,
        COUNT(m.*) FILTER (WHERE m.module_type = 'slide')            AS slides,
        COUNT(m.*) FILTER (WHERE m.module_type NOT IN ('video','quiz','pdf','slide')) AS others
      FROM courses c
      LEFT JOIN enrollments e ON e.course_id = c.id
      LEFT JOIN modules     m ON m.course_id = c.id
      WHERE c.organisation_id = $1
      GROUP BY c.id, c.name
      ORDER BY c.name
      `,
      [orgId]
    );

    const empRes = await client.query(
      `
      SELECT
        u.id,
        u.firstname,
        u.lastname
      FROM users u
      JOIN organisation_users ou
        ON ou.user_id = u.id
       AND ou.organisation_id = $1
       AND ou.role != 'admin'
      ORDER BY u.lastname, u.firstname
      `,
      [orgId]
    );

    const employees = await Promise.all(
      empRes.rows.map(async (emp) => {
        const uid = emp.id;

        const { rows: coursesDone } = await client.query(
          `SELECT c.id, c.name, e.completed_at
             FROM enrollments e
             JOIN courses c ON c.id = e.course_id
            WHERE e.user_id = $1
              AND e.status = 'completed'`,
          [uid]
        );

        const { rows: modCount } = await client.query(
          `SELECT COUNT(*) AS modules_done
             FROM module_status ms
             JOIN enrollments e ON e.id = ms.enrollment_id
            WHERE e.user_id = $1
              AND ms.status = 'completed'`,
          [uid]
        );
        const modulesDone = parseInt(modCount[0].modules_done, 10);

        const { rows: quizResults } = await client.query(
          `
          WITH latest AS (
            SELECT DISTINCT ON (qr.quiz_id)
                   qr.id           AS response_id,
                   qr.quiz_id,
                   qr.submitted_at
              FROM quiz_responses qr
             WHERE qr.user_id = $1
             ORDER BY qr.quiz_id, qr.submitted_at DESC
          ),
          answers AS (
            SELECT
              l.quiz_id,
              COUNT(*) FILTER (WHERE qo.is_correct AND qa.selected_option_id = qo.id) AS correct,
              COUNT(*)                                                               AS total,
              l.submitted_at,
              qz.title
            FROM latest l
            JOIN quiz_answers      qa ON qa.response_id = l.response_id
            JOIN question_options qo ON qo.id = qa.selected_option_id
            JOIN quizzes           qz ON qz.id = l.quiz_id
            GROUP BY l.quiz_id, l.submitted_at, qz.title
          )
          SELECT
            quiz_id,
            title,
            correct,
            total,
            ROUND(correct::decimal * 100 / NULLIF(total,0),1) AS score_pct,
            submitted_at AS taken_at
          FROM answers
          `,
          [uid]
        );

        const { rows: tagPerf } = await client.query(
          `
          WITH latest AS (
            SELECT DISTINCT ON (qr.quiz_id)
                   qr.id AS response_id,
                   qr.quiz_id
              FROM quiz_responses qr
             WHERE qr.user_id = $1
             ORDER BY qr.quiz_id, qr.submitted_at DESC
          ),
          user_ans AS (
            SELECT
              mt.tag_id,
              t.name       AS tag_name,
              CASE WHEN qo.is_correct THEN 1 ELSE 0 END AS is_correct
            FROM latest l
            JOIN quiz_answers      qa ON qa.response_id = l.response_id
            JOIN question_options qo ON qo.id = qa.selected_option_id
            JOIN quizzes           q  ON q.id = l.quiz_id
            JOIN revisions         r  ON r.id = q.revision_id
            JOIN module_tags       mt ON mt.module_id = r.module_id
            JOIN tags              t  ON t.id = mt.tag_id
          )
          SELECT
            tag_name,
            SUM(is_correct)                AS correct,
            COUNT(*)                       AS total,
            ROUND(SUM(is_correct)::decimal * 100 / NULLIF(COUNT(*),0), 1) AS pct
          FROM user_ans
          GROUP BY tag_name
          `,
          [uid]
        );

        const strengths = tagPerf.filter((r) => r.pct >= 80);
        const weaknesses = tagPerf.filter((r) => r.pct < 80);

        return {
          id: emp.id,
          firstname: emp.firstname,
          lastname: emp.lastname,
          coursesDone,
          modulesDone,
          quizResults,
          strengths,
          weaknesses,
        };
      })
    );

    await client.query("COMMIT");

    res.json({
      courses: coursesRes.rows,
      employees: {
        total: employees.length,
        list: employees,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Overview w/ employee-details error:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
