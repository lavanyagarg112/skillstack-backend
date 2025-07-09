const express = require("express");
const pool = require("../database/db");
const router = express.Router();

// Helper function to parse auth cookie
function getAuthUser(req) {
  const { auth } = req.cookies;
  if (!auth) return null;
  try {
    return JSON.parse(auth);
  } catch {
    return null;
  }
}

// Helper function to get courses from module IDs
async function getCoursesFromModules(client, moduleIds) {
  if (moduleIds.length === 0) return [];
  
  const result = await client.query(
    `SELECT DISTINCT course_id FROM modules WHERE id = ANY($1)`,
    [moduleIds]
  );
  
  return result.rows.map(row => row.course_id);
}

// Helper function to auto-enroll user in courses
async function ensureUserEnrolledInCourses(client, userId, courseIds) {
  const enrolledCourses = [];
  
  for (const courseId of courseIds) {
    try {
      // Check if already enrolled
      const existingEnrollment = await client.query(
        `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2`,
        [userId, courseId]
      );
      
      if (existingEnrollment.rows.length > 0) {
        continue; // Skip if already enrolled
      }

      // Create enrollment
      const insertRes = await client.query(
        `INSERT INTO enrollments (user_id, course_id, started_at)
           VALUES ($1, $2, NOW())
         RETURNING id`,
        [userId, courseId]
      );

      const enrollmentId = insertRes.rows[0].id;

      // Get all modules for this course
      const modulesRes = await client.query(
        `SELECT id FROM modules WHERE course_id = $1`,
        [courseId]
      );

      // Create module_status records
      for (const { id: moduleId } of modulesRes.rows) {
        await client.query(
          `INSERT INTO module_status
             (enrollment_id, module_id, status)
           VALUES ($1, $2, 'not_started')
           ON CONFLICT (enrollment_id, module_id) DO NOTHING`,
          [enrollmentId, moduleId]
        );
      }
      
      enrolledCourses.push(courseId);
    } catch (err) {
      if (err.code !== "23505") { // Ignore duplicate enrollment errors
        throw err;
      }
    }
  }
  
  return enrolledCourses;
}

// GET /api/roadmaps - Get user's roadmaps
router.get("/", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, user_id 
       FROM roadmaps 
       WHERE user_id = $1 
       ORDER BY id DESC`,
      [user.userId]
    );

    res.json({ roadmaps: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/roadmaps - Create new roadmap
router.post("/", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Roadmap name is required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO roadmaps (user_id, name) 
       VALUES ($1, $2) 
       RETURNING id, name, user_id`,
      [user.userId, name.trim()]
    );

    res.status(201).json({ roadmap: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// PUT /api/roadmaps/:id - Update roadmap
router.put("/:id", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const { id } = req.params;
  const { name } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Roadmap name is required" });
  }

  try {
    const result = await pool.query(
      `UPDATE roadmaps 
       SET name = $1 
       WHERE id = $2 AND user_id = $3 
       RETURNING id, name, user_id`,
      [name.trim(), id, user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Roadmap not found" });
    }

    res.json({ roadmap: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// DELETE /api/roadmaps/:id - Delete roadmap
router.delete("/:id", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM roadmaps 
       WHERE id = $1 AND user_id = $2 
       RETURNING id`,
      [id, user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Roadmap not found" });
    }

    res.json({ message: "Roadmap deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/roadmaps/:id/items - Get roadmap modules with details
router.get("/:id/items", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const { id } = req.params;

  try {
    // First verify the roadmap belongs to the user
    const roadmapCheck = await pool.query(
      `SELECT id FROM roadmaps WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    );

    if (roadmapCheck.rows.length === 0) {
      return res.status(404).json({ message: "Roadmap not found" });
    }

    // Get roadmap items with module details
    const result = await pool.query(
      `SELECT 
         ri.position,
         ri.module_id,
         mod.title as module_title,
         mod.description,
         mod.module_type,
         mod.file_url,
         c.name as course_name,
         c.id as course_id,
         CASE 
           WHEN e.id IS NOT NULL THEN 'enrolled'
           ELSE 'not_enrolled'
         END as enrollment_status,
         COALESCE(ms.status, 'not_started') as module_status
       FROM roadmap_items ri
       JOIN modules mod ON mod.id = ri.module_id
       JOIN courses c ON c.id = mod.course_id
       LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $2
       LEFT JOIN module_status ms ON ms.module_id = mod.id AND ms.enrollment_id = e.id
       WHERE ri.roadmap_id = $1
       ORDER BY ri.position ASC`,
      [id, user.userId]
    );

    res.json({ items: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/roadmaps/:id/items - Add module to roadmap
router.post("/:id/items", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const { id } = req.params;
  const { module_id } = req.body;

  if (!module_id) {
    return res.status(400).json({ message: "module_id is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verify roadmap belongs to user
    const roadmapCheck = await client.query(
      `SELECT id FROM roadmaps WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    );

    if (roadmapCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Roadmap not found" });
    }

    // Check if module is already in roadmap
    const existingCheck = await client.query(
      `SELECT 1 FROM roadmap_items WHERE roadmap_id = $1 AND module_id = $2`,
      [id, module_id]
    );

    if (existingCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Module already in roadmap" });
    }

    // Get next position
    const positionResult = await client.query(
      `SELECT COALESCE(MAX(position), 0) + 1 as next_position 
       FROM roadmap_items WHERE roadmap_id = $1`,
      [id]
    );

    const nextPosition = positionResult.rows[0].next_position;

    // Get course ID from module and auto-enroll user
    const courseIds = await getCoursesFromModules(client, [module_id]);
    const enrolledCourses = await ensureUserEnrolledInCourses(client, user.userId, courseIds);

    // Add module to roadmap
    await client.query(
      `INSERT INTO roadmap_items (roadmap_id, module_id, position)
       VALUES ($1, $2, $3)`,
      [id, module_id, nextPosition]
    );

    await client.query("COMMIT");

    res.status(201).json({ 
      message: "Module added to roadmap",
      position: nextPosition,
      enrolledCourses: enrolledCourses.length
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

// PUT /api/roadmaps/:id/items/:moduleId - Update item position
router.put("/:id/items/:moduleId", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const { id, moduleId } = req.params;
  const { position } = req.body;

  if (position === undefined || position < 1) {
    return res.status(400).json({ message: "Valid position is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verify roadmap belongs to user
    const roadmapCheck = await client.query(
      `SELECT id FROM roadmaps WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    );

    if (roadmapCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Roadmap not found" });
    }

    // Update position
    const result = await client.query(
      `UPDATE roadmap_items 
       SET position = $1 
       WHERE roadmap_id = $2 AND module_id = $3
       RETURNING position`,
      [position, id, moduleId]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Roadmap item not found" });
    }

    await client.query("COMMIT");

    res.json({ message: "Position updated", position: result.rows[0].position });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

// DELETE /api/roadmaps/:id/items/:moduleId - Remove module from roadmap (does not unenroll from course)
router.delete("/:id/items/:moduleId", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const { id, moduleId } = req.params;

  try {
    // Verify roadmap belongs to user and remove item
    // Note: We do NOT auto-unenroll from courses as user may be taking them independently
    const result = await pool.query(
      `DELETE FROM roadmap_items 
       WHERE roadmap_id = $1 AND module_id = $2
       AND EXISTS (
         SELECT 1 FROM roadmaps 
         WHERE id = $1 AND user_id = $3
       )
       RETURNING module_id`,
      [id, moduleId, user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Roadmap item not found" });
    }

    res.json({ message: "Module removed from roadmap" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/roadmaps/generate - Auto-generate roadmap based on user's onboarding tags
router.post("/generate", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Roadmap name is required" });
  }

  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Create the roadmap
    const roadmapResult = await client.query(
      `INSERT INTO roadmaps (user_id, name) 
       VALUES ($1, $2) 
       RETURNING id, name, user_id`,
      [user.userId, name.trim()]
    );

    const roadmap = roadmapResult.rows[0];

    // 2. Get user's tags from onboarding responses
    const userTagsResult = await client.query(
      `SELECT DISTINCT oqo.tag_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.tag_id IS NOT NULL`,
      [user.userId]
    );

    const userTagIds = userTagsResult.rows.map(row => row.tag_id);
    let modulesAdded = 0;
    let enrolledCourses = [];

    if (userTagIds.length > 0) {
      // 3. Get recommended modules based on user's tags
      const modulesResult = await client.query(
        `SELECT DISTINCT
           mod.id,
           COUNT(DISTINCT mt.tag_id) as matching_tags,
           RANDOM() as random_score
         FROM modules mod
         JOIN courses c ON c.id = mod.course_id
         JOIN module_tags mt ON mt.module_id = mod.id
         WHERE c.organisation_id = $1 
           AND mt.tag_id = ANY($2)
         GROUP BY mod.id
         ORDER BY matching_tags DESC, random_score
         LIMIT 10`, // Limit to top 10 modules
        [organisationId, userTagIds]
      );

      if (modulesResult.rows.length > 0) {
        const moduleIds = modulesResult.rows.map(row => row.id);
        
        // 4. Get courses from these modules and auto-enroll user
        const courseIds = await getCoursesFromModules(client, moduleIds);
        enrolledCourses = await ensureUserEnrolledInCourses(client, user.userId, courseIds);

        // 5. Add modules to roadmap
        for (let i = 0; i < modulesResult.rows.length; i++) {
          const module = modulesResult.rows[i];
          await client.query(
            `INSERT INTO roadmap_items (roadmap_id, module_id, position)
             VALUES ($1, $2, $3)`,
            [roadmap.id, module.id, i + 1]
          );
        }
        
        modulesAdded = modulesResult.rows.length;
      }
    }

    await client.query("COMMIT");

    res.status(201).json({ 
      roadmap,
      modulesAdded,
      enrolledCourses: enrolledCourses.length
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