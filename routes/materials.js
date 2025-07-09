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

  const { tag_ids } = req.query; // Comma-separated tag IDs

  try {
    let query = `
      SELECT DISTINCT
         mod.id,
         mod.title as module_title,
         mod.description,
         mod.module_type,
         mod.file_url,
         c.name as course_name,
         c.id as course_id,
         ARRAY_AGG(DISTINCT t.name) as tags
       FROM modules mod
       JOIN courses c ON c.id = mod.course_id
       LEFT JOIN module_tags mt ON mt.module_id = mod.id
       LEFT JOIN tags t ON t.id = mt.tag_id
       WHERE c.organisation_id = $1`;
    
    const params = [organisationId];
    
    // If tag_ids are provided, filter by those tags
    if (tag_ids) {
      const tagIdArray = tag_ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
      if (tagIdArray.length > 0) {
        query += ` AND mt.tag_id = ANY($2)`;
        params.push(tagIdArray);
      }
    }
    
    query += ` GROUP BY mod.id, mod.title, mod.description, mod.module_type, mod.file_url, c.name, c.id
               ORDER BY c.name, mod.title`;

    const result = await pool.query(query, params);

    res.json({ materials: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/materials/by-user-tags - Get modules recommended based on user's onboarding tags
router.get("/by-user-tags", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  try {
    // Get user's tags from onboarding responses
    const userTagsResult = await pool.query(
      `SELECT DISTINCT oqo.tag_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.tag_id IS NOT NULL`,
      [user.userId]
    );

    const userTagIds = userTagsResult.rows.map(row => row.tag_id);
    
    if (userTagIds.length === 0) {
      return res.json({ materials: [] });
    }

    // Get modules that match user's tags
    const result = await pool.query(
      `SELECT DISTINCT
         mod.id,
         mod.title as module_title,
         mod.description,
         mod.module_type,
         mod.file_url,
         c.name as course_name,
         c.id as course_id,
         ARRAY_AGG(DISTINCT t.name) as tags,
         COUNT(DISTINCT mt.tag_id) as matching_tags
       FROM modules mod
       JOIN courses c ON c.id = mod.course_id
       JOIN module_tags mt ON mt.module_id = mod.id
       JOIN tags t ON t.id = mt.tag_id
       WHERE c.organisation_id = $1 
         AND mt.tag_id = ANY($2)
       GROUP BY mod.id, mod.title, mod.description, mod.module_type, mod.file_url, c.name, c.id
       ORDER BY matching_tags DESC, c.name, mod.title`,
      [organisationId, userTagIds]
    );

    res.json({ 
      materials: result.rows,
      userTags: userTagIds
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;