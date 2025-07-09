const express = require("express");
const pool = require("../database/db");
const router = express.Router();
const {
  getUserPreferences,
  getCoursesFromModules,
  ensureUserEnrolledInCourses,
} = require("./roadmaps-helpers");

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
         COALESCE(ms.status, 'not_started') as module_status,
         JSON_BUILD_OBJECT(
           'id', ch.id,
           'name', ch.name,
           'description', ch.description
         ) AS channel,
         JSON_BUILD_OBJECT(
           'id', l.id,
           'name', l.name,
           'description', l.description,
           'sort_order', l.sort_order
         ) AS level
       FROM roadmap_items ri
       JOIN modules mod ON mod.id = ri.module_id
       JOIN courses c ON c.id = mod.course_id
       LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $2
       LEFT JOIN module_status ms ON ms.module_id = mod.id AND ms.enrollment_id = e.id
       LEFT JOIN course_channels cc ON cc.course_id = c.id
       LEFT JOIN channels ch ON ch.id = cc.channel_id
       LEFT JOIN levels l ON l.id = cc.level_id
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
    const enrolledCourses = await ensureUserEnrolledInCourses(
      client,
      user.userId,
      courseIds
    );

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
      enrolledCourses: enrolledCourses.length,
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

    res.json({
      message: "Position updated",
      position: result.rows[0].position,
    });
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

// POST /api/roadmaps/generate - Auto-generate roadmap based on user's onboarding skills
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

    // 2. Get user's skills from onboarding responses
    const userSkillsResult = await client.query(
      `SELECT DISTINCT oqo.skill_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.skill_id IS NOT NULL`,
      [user.userId]
    );

    // 3. Get user's channel and level preferences (combines member settings and onboarding)
    const userPreferences = await getUserPreferences(client, user.userId);

    const userSkillIds = userSkillsResult.rows.map((row) => row.skill_id);
    const userChannelIds = userPreferences.channels?.all || [];
    const userLevelIds = userPreferences.levels?.all || [];
    let modulesAdded = 0;
    let enrolledCourses = [];

    if (userSkillIds.length > 0) {
      // 4. Get recommended modules with enhanced scoring based on member preferences
      // Exclude modules that the user has already completed
      let query = `SELECT DISTINCT
           mod.id,
           COUNT(DISTINCT ms.skill_id) as matching_skills,
           CASE 
             WHEN cc.channel_id = ANY($3) THEN 
               CASE 
                 WHEN cc.channel_id = ANY($5) THEN 5  -- Member setting preference (highest priority)
                 ELSE 3  -- Onboarding preference
               END
             WHEN cc.channel_id IS NOT NULL THEN 1 
             ELSE 0 
           END as channel_match,
           CASE 
             WHEN cc.level_id = ANY($4) THEN 
               CASE 
                 WHEN cc.level_id = ANY($6) THEN 5  -- Member setting preference (highest priority)
                 ELSE 3  -- Onboarding preference
               END
             WHEN cc.level_id IS NOT NULL THEN 1 
             ELSE 0 
           END as level_match,
           cc.channel_id,
           cc.level_id,
           RANDOM() as random_score
         FROM modules mod
         JOIN courses c ON c.id = mod.course_id
         JOIN module_skills ms ON ms.module_id = mod.id
         LEFT JOIN course_channels cc ON cc.course_id = c.id
         LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $7
         LEFT JOIN module_status mst ON mst.module_id = mod.id AND mst.enrollment_id = e.id
         WHERE c.organisation_id = $1 
           AND ms.skill_id = ANY($2)
           AND (mst.status IS NULL OR mst.status IN ('not_started', 'in_progress'))`;

      const params = [
        organisationId,
        userSkillIds,
        userChannelIds,
        userLevelIds,
        userPreferences.channels.member,
        userPreferences.levels.member,
        user.userId,
      ];

      // Add additional filtering for preferred channels and levels if they exist
      if (userChannelIds.length > 0 || userLevelIds.length > 0) {
        query += ` AND (`;
        const conditions = [];

        if (userChannelIds.length > 0) {
          conditions.push(`cc.channel_id = ANY($3)`);
        }

        if (userLevelIds.length > 0) {
          conditions.push(`cc.level_id = ANY($4)`);
        }

        // Also include modules without specific channel/level assignments
        conditions.push(`cc.channel_id IS NULL OR cc.level_id IS NULL`);

        query += conditions.join(" OR ") + ")";
      }

      query += ` GROUP BY mod.id, cc.channel_id, cc.level_id
         ORDER BY matching_skills DESC, channel_match DESC, level_match DESC, random_score
         LIMIT 10`; // Limit to top 10 modules

      const modulesResult = await client.query(query, params);

      if (modulesResult.rows.length > 0) {
        const moduleIds = modulesResult.rows.map((row) => row.id);

        // 5. Get courses from these modules and auto-enroll user
        const courseIds = await getCoursesFromModules(client, moduleIds);
        enrolledCourses = await ensureUserEnrolledInCourses(
          client,
          user.userId,
          courseIds
        );

        // 6. Add modules to roadmap
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
      enrolledCourses: enrolledCourses.length,
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
