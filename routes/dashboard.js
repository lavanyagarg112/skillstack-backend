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
  if (!user || !user.isLoggedIn)
    return res.status(401).json({ message: "Not logged in" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = user.userId;

    const { rows: currCourse } = await client.query(
      `SELECT c.id, c.name
         FROM enrollments e
    JOIN courses c ON c.id = e.course_id
        WHERE e.user_id = $1
          AND e.status = 'enrolled'
        ORDER BY e.started_at DESC
        LIMIT 1`,
      [userId]
    );

    let currModule = null;
    if (currCourse.length) {
      const courseId = currCourse[0].id;
      const { rows } = await client.query(
        `SELECT m.id, m.title
           FROM module_status ms
     JOIN modules m ON m.id = ms.module_id
          WHERE ms.enrollment_id = (
                  SELECT id FROM enrollments
                   WHERE user_id  = $1
                     AND course_id = $2
               )
            AND ms.status = 'in_progress'
          ORDER BY ms.started_at DESC
          LIMIT 1`,
        [userId, courseId]
      );
      currModule = rows[0] || null;
    }

    const { rows: rm } = await client.query(
      `SELECT id FROM roadmaps
        WHERE user_id = $1
        ORDER BY id DESC
        LIMIT 1`,
      [userId]
    );
    let roadmapProgress = { completed: 0, total: 0 };
    if (rm.length) {
      const roadmapId = rm[0].id;
      const { rows } = await client.query(
        `SELECT 
           COUNT(*) FILTER(WHERE ri.module_id IS NOT NULL)       AS total,
           COUNT(*) FILTER(WHERE ms.status = 'completed')             AS completed
         FROM roadmap_items ri
    LEFT JOIN module_status ms
           ON ms.module_id = ri.module_id
          AND ms.enrollment_id = (
               SELECT id FROM enrollments
                WHERE user_id = $1
                  AND course_id = (
                    SELECT course_id FROM modules WHERE id = ri.module_id
                  )
             )
        WHERE ri.roadmap_id = $2`,
        [userId, roadmapId]
      );
      roadmapProgress = rows[0];
    }

    let courseProgress = { completed: 0, total: 0 };
    if (currCourse.length) {
      const courseId = currCourse[0].id;
      const { rows } = await client.query(
        `SELECT
           COUNT(m.id)                             AS total,
           COUNT(ms.id) FILTER(ms.status = 'completed') AS completed
         FROM modules m
    LEFT JOIN module_status ms
           ON ms.module_id     = m.id
          AND ms.enrollment_id = (
               SELECT id FROM enrollments
                WHERE user_id  = $1
                  AND course_id = $2
             )
        WHERE m.course_id = $2`,
        [userId, currCourse[0].id]
      );
      courseProgress = rows[0];
    }

    await client.query("COMMIT");
    res.json({
      welcome: `Welcome, ${user.firstname}!`,
      currentCourse: currCourse[0] || null,
      currentModule: currModule,
      roadmapProgress,
      courseProgress,
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
