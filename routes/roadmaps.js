const express = require("express");
const pool = require("../database/db");
const router = express.Router();
const logActivity = require("./activityLogger");
const {
  getUserPreferences,
  getCoursesFromModules,
  ensureUserEnrolledInCourses,
} = require("./roadmaps-helpers");

function getAuthUser(req) {
  const { auth } = req.cookies;
  if (!auth) return null;
  try {
    return JSON.parse(auth);
  } catch {
    return null;
  }
}

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

    await logActivity({
      userId: user.userId,
      organisationId: user.organisation?.id,
      action: "create_roadmap",
      metadata: { roadmapId: result.rows[0].id },
      displayMetadata: { "roadmap name": name.trim() },
    });

    res.status(201).json({ roadmap: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

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

    await logActivity({
      userId: user.userId,
      organisationId: user.organisation?.id,
      action: "edit_roadmap",
      metadata: { roadmapId: result.id, newName: name.trim() },
      displayMetadata: { "roadmap name": name.trim() },
    });

    res.json({ roadmap: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/:id", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const { id } = req.params;

  try {
    const roadMapRes = await pool.query(
      `SELECT id, name FROM roadmaps WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    );

    if (roadMapRes.rows.length === 0) {
      return res.status(404).json({ message: "Roadmap not found" });
    }
    const roadmapName = roadMapRes.rows[0].name;

    const result = await pool.query(
      `DELETE FROM roadmaps 
       WHERE id = $1 AND user_id = $2 
       RETURNING id`,
      [id, user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Roadmap not found" });
    }

    await logActivity({
      userId: user.userId,
      organisationId: user.organisation?.id,
      action: "delete_roadmap",
      metadata: { roadmapId: id },
      displayMetadata: { "roadmap name": roadmapName },
    });

    res.json({ message: "Roadmap deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/:id/items", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const { id } = req.params;

  try {
    const roadmapCheck = await pool.query(
      `SELECT id FROM roadmaps WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    );

    if (roadmapCheck.rows.length === 0) {
      return res.status(404).json({ message: "Roadmap not found" });
    }

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

    const roadmapCheck = await client.query(
      `SELECT id FROM roadmaps WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    );

    if (roadmapCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Roadmap not found" });
    }

    const existingCheck = await client.query(
      `SELECT 1 FROM roadmap_items WHERE roadmap_id = $1 AND module_id = $2`,
      [id, module_id]
    );

    if (existingCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Module already in roadmap" });
    }

    const positionResult = await client.query(
      `SELECT COALESCE(MAX(position), 0) + 1 as next_position 
       FROM roadmap_items WHERE roadmap_id = $1`,
      [id]
    );

    const nextPosition = positionResult.rows[0].next_position;

    const roadmapNameRes = await pool.query(
      `SELECT name FROM roadmaps WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    );
    const roadmapName = roadmapNameRes.rows[0]?.name;

    const courseIds = await getCoursesFromModules(client, [module_id]);
    const enrolledCourses = await ensureUserEnrolledInCourses(
      client,
      user.userId,
      courseIds
    );

    await client.query(
      `INSERT INTO roadmap_items (roadmap_id, module_id, position)
       VALUES ($1, $2, $3)`,
      [id, module_id, nextPosition]
    );

    const moduleNameRes = await pool.query(
      `SELECT mod.title as module_title
       FROM modules mod
       WHERE mod.id = $1
       `,
      [module_id]
    );

    if (moduleNameRes.rows.length === 0) {
      return res.status(404).json({ message: "Module item not found" });
    }

    const moduleName = moduleNameRes.rows[0].module_title;

    await client.query("COMMIT");

    await logActivity({
      userId: user.userId,
      organisationId: user.organisation?.id,
      action: "add_roadmap_item",
      metadata: { roadmapId: id, moduleId: module_id, position: nextPosition },
      displayMetadata: {
        "roadmap name": roadmapName,
        "module name": moduleName,
      },
    });

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

    const roadmapCheck = await client.query(
      `SELECT id FROM roadmaps WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    );

    if (roadmapCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Roadmap not found" });
    }

    const roadmapNameRes = await pool.query(
      `SELECT name FROM roadmaps WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    );
    const roadmapName = roadmapNameRes.rows[0]?.name;

    const moduleNameRes = await pool.query(
      `SELECT mod.title as module_title
       FROM modules mod
       WHERE mod.id = $1
       `,
      [moduleId]
    );

    if (moduleNameRes.rows.length === 0) {
      return res.status(404).json({ message: "Module item not found" });
    }

    const moduleName = moduleNameRes.rows[0].module_title;

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

    await logActivity({
      userId: user.userId,
      organisationId: user.organisation?.id,
      action: "move_roadmap_item",
      metadata: { roadmapId: id, moduleId, newPosition: position },
      displayMetadata: {
        "roadmap name": roadmapName,
        "module name": moduleName,
      },
    });

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

router.delete("/:id/items/:moduleId", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const { id, moduleId } = req.params;

  try {
    const moduleNameRes = await pool.query(
      `SELECT mod.title as module_title
       FROM modules mod
       WHERE mod.id = $1
       `,
      [moduleId]
    );

    if (moduleNameRes.rows.length === 0) {
      return res.status(404).json({ message: "Module item not found" });
    }

    const moduleName = moduleNameRes.rows[0].module_title;

    const roadmapNameRes = await pool.query(
      `SELECT name FROM roadmaps WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    );
    const roadmapName = roadmapNameRes.rows[0]?.name;
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

    await logActivity({
      userId: user.userId,
      organisationId: user.organisation?.id,
      action: "remove_roadmap_item",
      metadata: { roadmapId: id, moduleId },
      displayMetadata: {
        "roadmap name": roadmapName,
        "module name": moduleName,
      },
    });

    res.json({ message: "Module removed from roadmap" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

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

    const roadmapResult = await client.query(
      `INSERT INTO roadmaps (user_id, name) 
       VALUES ($1, $2) 
       RETURNING id, name, user_id`,
      [user.userId, name.trim()]
    );

    const roadmap = roadmapResult.rows[0];

    const userSkillsResult = await client.query(
      `SELECT DISTINCT oqo.skill_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.skill_id IS NOT NULL`,
      [user.userId]
    );

    const userPreferences = await getUserPreferences(client, user.userId);

    const userSkillIds = userSkillsResult.rows.map((row) => row.skill_id);
    const userChannelIds = userPreferences.channels?.all || [];
    const userLevelIds = userPreferences.levels?.all || [];
    let modulesAdded = 0;
    let enrolledCourses = [];

    const hasPreferences =
      userSkillIds.length > 0 ||
      userChannelIds.length > 0 ||
      userLevelIds.length > 0;

    if (hasPreferences) {
      let query = `SELECT DISTINCT
           mod.id,
           COALESCE(COUNT(DISTINCT ms.skill_id), 0) as matching_skills,
           CASE 
             WHEN cc.channel_id = ANY($2) THEN 
               CASE 
                 WHEN cc.channel_id = ANY($4) THEN 5  -- Member setting preference (highest priority)
                 ELSE 3  -- Onboarding preference
               END
             WHEN cc.channel_id IS NOT NULL THEN 1 
             ELSE 0 
           END as channel_match,
           CASE 
             WHEN cc.level_id = ANY($3) THEN 
               CASE 
                 WHEN cc.level_id = ANY($5) THEN 5  -- Member setting preference (highest priority)
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
         LEFT JOIN module_skills ms ON ms.module_id = mod.id
         LEFT JOIN course_channels cc ON cc.course_id = c.id
         LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $6
         LEFT JOIN module_status mst ON mst.module_id = mod.id AND mst.enrollment_id = e.id
         WHERE c.organisation_id = $1 
           AND (mst.status IS NULL OR mst.status IN ('not_started', 'in_progress'))`;

      let params = [
        organisationId,
        userChannelIds,
        userLevelIds,
        userPreferences.channels.member,
        userPreferences.levels.member,
        user.userId,
      ];

      if (userSkillIds.length > 0) {
        query += ` AND ms.skill_id = ANY($7)`;
        params.push(userSkillIds);
      }

      query += ` GROUP BY mod.id, cc.channel_id, cc.level_id
         ORDER BY matching_skills DESC, channel_match DESC, level_match DESC, random_score
         LIMIT 10`; // Limit to top 10 modules

      const modulesResult = await client.query(query, params);

      if (modulesResult.rows.length > 0) {
        const newModuleIds = modulesResult.rows.map((row) => row.id);
        const newModuleSet = new Set(newModuleIds);

        const existingRoadmapsRes = await client.query(
          `SELECT array_agg(ri.module_id ORDER BY ri.module_id) AS modules
     FROM roadmap_items ri
     JOIN roadmaps r ON r.id = ri.roadmap_id
     WHERE r.user_id = $1
     GROUP BY ri.roadmap_id`,
          [user.userId]
        );

        const isDuplicate = existingRoadmapsRes.rows.some(({ modules }) => {
          if (modules.length !== newModuleIds.length) return false;
          return modules.every((mid) => newModuleSet.has(mid));
        });

        if (isDuplicate) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message: "A roadmap with the same set of modules already exists.",
          });
        }

        const courseIds = await getCoursesFromModules(client, newModuleIds);
        enrolledCourses = await ensureUserEnrolledInCourses(
          client,
          user.userId,
          courseIds
        );

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

    await logActivity({
      userId: user.userId,
      organisationId: user.organisation?.id,
      action: "generate_roadmap",
      metadata: { roadmapId: roadmap.id, modulesAdded, enrolledCourses },
      displayMetadata: { "roadmap name": name.trim() },
    });

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
