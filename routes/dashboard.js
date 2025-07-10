const express = require("express");
const pool = require("../database/db");
const router = express.Router();

function getAuthUser(req) {
  const { auth } = req.cookies;
  if (!auth) return null;
  try {
    return JSON.parse(auth);
  } catch {
    return null;
  }
}

router.get("/user-dashboard", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = user.userId;

    const { rows: currCourseArr } = await client.query(
      `SELECT c.id, c.name
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
        WHERE e.user_id = $1
          AND e.status IN ('enrolled', 'in_progress')
        ORDER BY e.started_at DESC NULLS LAST
        LIMIT 1`,
      [userId]
    );
    const currentCourse = currCourseArr[0] || null;

    let currentModule = null;
    if (currentCourse) {
      const { rows: moduleArr } = await client.query(
        `SELECT m.id, m.title
           FROM modules m
           JOIN module_status ms ON ms.module_id = m.id
          WHERE ms.enrollment_id = (
                  SELECT id FROM enrollments
                  WHERE user_id = $1 AND course_id = $2
                  LIMIT 1
                )
            AND ms.status = 'in_progress'
          ORDER BY ms.started_at DESC NULLS LAST
          LIMIT 1`,
        [userId, currentCourse.id]
      );
      currentModule = moduleArr[0] || null;
    }

    let nextToLearn = [];
    if (currentCourse) {
      const { rows: learnArr } = await client.query(
        `SELECT m.id, m.title
           FROM modules m
           LEFT JOIN module_status ms
             ON ms.module_id = m.id
            AND ms.enrollment_id = (
              SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 LIMIT 1
            )
          WHERE m.course_id = $2
            AND (ms.status IS NULL OR ms.status = 'not_started')
          ORDER BY m.position ASC
          LIMIT 2`,
        [userId, currentCourse.id]
      );
      nextToLearn = learnArr;
    }

    let toRevise = [];
    if (currentCourse) {
      const { rows: reviseArr } = await client.query(
        `SELECT m.id, m.title
           FROM modules m
           JOIN module_status ms
             ON ms.module_id = m.id
            AND ms.enrollment_id = (
              SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 LIMIT 1
            )
          WHERE ms.status = 'completed'
          ORDER BY ms.completed_at DESC NULLS LAST
          LIMIT 1`,
        [userId, currentCourse.id]
      );
      toRevise = reviseArr;
    }

    let summaryStats = { completedModules: 0, totalModules: 0 };
    if (currentCourse) {
      const { rows } = await client.query(
        `SELECT
            COUNT(m.id) AS "totalModules",
            COUNT(ms.id) FILTER (WHERE ms.status = 'completed') AS "completedModules"
           FROM modules m
      LEFT JOIN module_status ms
             ON ms.module_id = m.id
            AND ms.enrollment_id = (
              SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 LIMIT 1
            )
          WHERE m.course_id = $2`,
        [userId, currentCourse.id]
      );
      summaryStats = rows[0];
    }

    await client.query("COMMIT");
    res.json({
      welcome: `Welcome, ${user.firstname}!`,
      currentCourse,
      currentModule,
      nextToLearn,
      toRevise,
      summaryStats,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.get("/admin-dashboard", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn || user.organisation.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orgId = user.organisation.id;

    const { rows: employees } = await client.query(
      `
  SELECT
    u.id,
    u.firstname,
    u.lastname,
    COUNT(e.id) FILTER (WHERE e.status IN ('enrolled','completed'))   AS "totalCourses",
    COUNT(e.id) FILTER (WHERE e.status = 'completed')                  AS "completedCourses"
  FROM users u
  JOIN organisation_users ou
    ON ou.user_id = u.id
  LEFT JOIN enrollments e
    ON e.user_id = u.id
  WHERE ou.organisation_id = $1
    AND ou.role = 'employee'
  GROUP BY u.id, u.firstname, u.lastname
  ORDER BY u.lastname, u.firstname
  `,
      [orgId]
    );

    const { rows: enrollments } = await client.query(
      `SELECT c.name               AS courseName,
              COUNT(e.id)          AS enrolledCount
         FROM courses c
    LEFT JOIN enrollments e ON e.course_id = c.id
        WHERE c.organisation_id = $1
        GROUP BY c.id, c.name
        ORDER BY enrolledCount DESC`,
      [orgId]
    );

    await client.query("COMMIT");
    res.json({
      welcome: `Welcome, Admin ${user.firstname}!`,
      employees,
      enrollments,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
