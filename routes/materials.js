const express = require("express");
const pool = require("../database/db");
const router = express.Router();
const { getUserPreferences } = require("./roadmaps-helpers");

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

// GET /api/materials - Get all modules for the user's organization
router.get("/", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  const { skill_ids } = req.query; // Comma-separated skill IDs

  try {
    let query = `
      SELECT
         mod.id,
         mod.title as module_title,
         mod.description,
         mod.module_type,
         mod.file_url,
         c.name as course_name,
         c.id as course_id,
         ARRAY_AGG(DISTINCT s.name) as skills,
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
       FROM modules mod
       JOIN courses c ON c.id = mod.course_id
       LEFT JOIN module_skills ms ON ms.module_id = mod.id
       LEFT JOIN skills s ON s.id = ms.skill_id
       LEFT JOIN course_channels cc ON cc.course_id = c.id
       LEFT JOIN channels ch ON ch.id = cc.channel_id
       LEFT JOIN levels l ON l.id = cc.level_id
       WHERE c.organisation_id = $1`;

    const params = [organisationId];

    // If skill_ids are provided, filter by those skills
    if (skill_ids) {
      const skillIdArray = skill_ids
        .split(",")
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      if (skillIdArray.length > 0) {
        query += ` AND ms.skill_id = ANY($2)`;
        params.push(skillIdArray);
      }
    }

    query += ` GROUP BY mod.id, mod.title, mod.description, mod.module_type, mod.file_url, c.name, c.id, ch.id, ch.name, ch.description, l.id, l.name, l.description, l.sort_order
               ORDER BY c.name, mod.title`;

    const result = await pool.query(query, params);

    res.json({ materials: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/materials/by-user-skills - Get modules recommended based on user's skills and preferences
router.get("/by-user-skills", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  const client = await pool.connect();
  try {
    // Get user's skills from onboarding responses
    const userSkillsResult = await client.query(
      `SELECT DISTINCT oqo.skill_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.skill_id IS NOT NULL`,
      [user.userId]
    );

    const userSkillIds = userSkillsResult.rows.map((row) => row.skill_id);

    if (userSkillIds.length === 0) {
      return res.json({ materials: [] });
    }

    // Get user's channel and level preferences (combines member settings and onboarding)
    const userPreferences = await getUserPreferences(client, user.userId);

    // Get modules that match user's skills with enhanced scoring based on member preferences
    const result = await client.query(
      `SELECT DISTINCT
         mod.id,
         mod.title as module_title,
         mod.description,
         mod.module_type,
         mod.file_url,
         c.name as course_name,
         c.id as course_id,
         ARRAY_AGG(DISTINCT s.name) as skills,
         COUNT(DISTINCT ms.skill_id) as matching_skills,
         CASE 
           WHEN cc.channel_id = ANY($3) THEN 
             CASE 
               WHEN cc.channel_id = ANY($4) THEN 5  -- Member setting preference (highest priority)
               ELSE 3  -- Onboarding preference
             END
           WHEN cc.channel_id IS NOT NULL THEN 1 
           ELSE 0 
         END as channel_match,
         CASE 
           WHEN cc.level_id = ANY($5) THEN 
             CASE 
               WHEN cc.level_id = ANY($6) THEN 5  -- Member setting preference (highest priority)
               ELSE 3  -- Onboarding preference
             END
           WHEN cc.level_id IS NOT NULL THEN 1 
           ELSE 0 
         END as level_match,
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
       FROM modules mod
       JOIN courses c ON c.id = mod.course_id
       JOIN module_skills ms ON ms.module_id = mod.id
       JOIN skills s ON s.id = ms.skill_id
       LEFT JOIN course_channels cc ON cc.course_id = c.id
       LEFT JOIN channels ch ON ch.id = cc.channel_id
       LEFT JOIN levels l ON l.id = cc.level_id
       WHERE c.organisation_id = $1 
         AND ms.skill_id = ANY($2)
       GROUP BY mod.id, mod.title, mod.description, mod.module_type, mod.file_url, c.name, c.id, ch.id, ch.name, ch.description, l.id, l.name, l.description, l.sort_order, cc.channel_id, cc.level_id
       ORDER BY matching_skills DESC, channel_match DESC, level_match DESC, c.name, mod.title`,
      [
        organisationId,
        userSkillIds,
        userPreferences.channels.all,
        userPreferences.channels.member,
        userPreferences.levels.all,
        userPreferences.levels.member,
      ]
    );

    res.json({
      materials: result.rows,
      userSkills: userSkillIds,
      userPreferences: {
        channels: userPreferences.channels,
        levels: userPreferences.levels,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

// Backward compatibility: redirect old by-user-tags to new by-user-skills
router.get("/by-user-tags", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  const client = await pool.connect();
  try {
    // Get user's skills from onboarding responses
    const userSkillsResult = await client.query(
      `SELECT DISTINCT oqo.skill_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.skill_id IS NOT NULL`,
      [user.userId]
    );

    const userSkillIds = userSkillsResult.rows.map((row) => row.skill_id);

    if (userSkillIds.length === 0) {
      return res.json({ materials: [] });
    }

    // Get user's channel and level preferences (combines member settings and onboarding)
    const userPreferences = await getUserPreferences(client, user.userId);

    // Get modules that match user's skills with enhanced scoring based on member preferences
    const result = await client.query(
      `SELECT DISTINCT
         mod.id,
         mod.title as module_title,
         mod.description,
         mod.module_type,
         mod.file_url,
         c.name as course_name,
         c.id as course_id,
         ARRAY_AGG(DISTINCT s.name) as skills,
         COUNT(DISTINCT ms.skill_id) as matching_skills,
         CASE 
           WHEN cc.channel_id = ANY($3) THEN 
             CASE 
               WHEN cc.channel_id = ANY($4) THEN 5  -- Member setting preference (highest priority)
               ELSE 3  -- Onboarding preference
             END
           WHEN cc.channel_id IS NOT NULL THEN 1 
           ELSE 0 
         END as channel_match,
         CASE 
           WHEN cc.level_id = ANY($5) THEN 
             CASE 
               WHEN cc.level_id = ANY($6) THEN 5  -- Member setting preference (highest priority)
               ELSE 3  -- Onboarding preference
             END
           WHEN cc.level_id IS NOT NULL THEN 1 
           ELSE 0 
         END as level_match,
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
       FROM modules mod
       JOIN courses c ON c.id = mod.course_id
       JOIN module_skills ms ON ms.module_id = mod.id
       JOIN skills s ON s.id = ms.skill_id
       LEFT JOIN course_channels cc ON cc.course_id = c.id
       LEFT JOIN channels ch ON ch.id = cc.channel_id
       LEFT JOIN levels l ON l.id = cc.level_id
       WHERE c.organisation_id = $1 
         AND ms.skill_id = ANY($2)
       GROUP BY mod.id, mod.title, mod.description, mod.module_type, mod.file_url, c.name, c.id, ch.id, ch.name, ch.description, l.id, l.name, l.description, l.sort_order, cc.channel_id, cc.level_id
       ORDER BY matching_skills DESC, channel_match DESC, level_match DESC, c.name, mod.title`,
      [
        organisationId,
        userSkillIds,
        userPreferences.channels.all,
        userPreferences.channels.member,
        userPreferences.levels.all,
        userPreferences.levels.member,
      ]
    );

    res.json({
      materials: result.rows,
      userTags: userSkillIds, // Keep old property name for backward compatibility
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
