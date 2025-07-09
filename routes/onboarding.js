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

function isAdmin(user) {
  return user && user.organisation && user.organisation.role === "admin";
}

function isEmployee(user) {
  return user && user.organisation && user.organisation.role === "employee";
}

router.get("/questions", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  try {
    const questionsResult = await pool.query(
      `
      SELECT id, question_text, position 
      FROM onboarding_questions 
      WHERE organisation_id = $1
      ORDER BY position ASC
    `,
      [organisationId]
    );

    const questions = [];
    for (const question of questionsResult.rows) {
      const optionsResult = await pool.query(
        `
        SELECT oqo.id, oqo.option_text, oqo.skill_id, s.name as skill_name, s.description as skill_description,
               oqo.channel_id, ch.name as channel_name, ch.description as channel_description,
               oqo.level_id, l.name as level_name, l.description as level_description, l.sort_order
        FROM onboarding_question_options oqo
        LEFT JOIN skills s ON s.id = oqo.skill_id
        LEFT JOIN channels ch ON ch.id = oqo.channel_id
        LEFT JOIN levels l ON l.id = oqo.level_id
        WHERE oqo.question_id = $1
        ORDER BY oqo.id ASC
      `,
        [question.id]
      );

      questions.push({
        id: question.id,
        question_text: question.question_text,
        position: question.position,
        options: optionsResult.rows,
      });
    }

    res.json({ questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/questions", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  if (!isAdmin(user)) {
    return res.status(403).json({ message: "Admin access required" });
  }

  const { question_text, position = 0 } = req.body;
  if (!question_text) {
    return res.status(400).json({ message: "question_text is required" });
  }

  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO onboarding_questions (question_text, position, organisation_id)
      VALUES ($1, $2, $3)
      RETURNING id, question_text, position
    `,
      [question_text, position, organisationId]
    );

    res.status(201).json({ question: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/questions/:id/options", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  if (!isAdmin(user)) {
    return res.status(403).json({ message: "Admin access required" });
  }

  const { id } = req.params;
  const { option_text, skill_id, channel_id, level_id } = req.body;

  if (!option_text) {
    return res.status(400).json({ message: "option_text is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const organisationId = user.organisation?.id;
    if (!organisationId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Organization required" });
    }

    const questionCheck = await client.query(
      "SELECT id FROM onboarding_questions WHERE id = $1 AND organisation_id = $2",
      [id, organisationId]
    );
    if (questionCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Question not found" });
    }

    let skillCheck = { rows: [] };
    if (skill_id) {
      skillCheck = await client.query(
        "SELECT id, name, description FROM skills WHERE id = $1 AND organisation_id = $2",
        [skill_id, organisationId]
      );
      if (skillCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Skill not found" });
      }
    }

    let channelCheck = { rows: [] };
    if (channel_id) {
      channelCheck = await client.query(
        "SELECT id, name, description FROM channels WHERE id = $1 AND organisation_id = $2",
        [channel_id, organisationId]
      );
      if (channelCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Channel not found" });
      }
    }

    let levelCheck = { rows: [] };
    if (level_id) {
      levelCheck = await client.query(
        "SELECT id, name, description, sort_order FROM levels WHERE id = $1 AND organisation_id = $2",
        [level_id, organisationId]
      );
      if (levelCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Level not found" });
      }
    }

    const result = await client.query(
      `
      INSERT INTO onboarding_question_options (question_id, option_text, skill_id, channel_id, level_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, option_text, skill_id, channel_id, level_id
    `,
      [id, option_text, skill_id || null, channel_id || null, level_id || null]
    );

    await client.query("COMMIT");

    const option = {
      ...result.rows[0],
      skill_name: skill_id ? skillCheck.rows[0].name : null,
      skill_description: skill_id ? skillCheck.rows[0].description : null,
      channel_name: channel_id ? channelCheck.rows[0].name : null,
      channel_description: channel_id ? channelCheck.rows[0].description : null,
      level_name: level_id ? levelCheck.rows[0].name : null,
      level_description: level_id ? levelCheck.rows[0].description : null,
      level_sort_order: level_id ? levelCheck.rows[0].sort_order : null,
    };

    res.status(201).json({ option });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.delete("/questions/:id", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  if (!isAdmin(user)) {
    return res.status(403).json({ message: "Admin access required" });
  }

  const { id } = req.params;

  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  try {
    const optionCheck = await pool.query(
      "SELECT COUNT(*) as option_count FROM onboarding_question_options WHERE question_id = $1",
      [id]
    );

    const hasOptions = parseInt(optionCheck.rows[0].option_count) > 0;
    if (hasOptions) {
      return res.status(400).json({
        message:
          "Cannot delete question that has options. Please delete all options first.",
      });
    }

    const result = await pool.query(
      "DELETE FROM onboarding_questions WHERE id = $1 AND organisation_id = $2 RETURNING id",
      [id, organisationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Question not found" });
    }

    res.json({ message: "Question deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/options/:optionId", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  if (!isAdmin(user)) {
    return res.status(403).json({ message: "Admin access required" });
  }

  const { optionId } = req.params;
  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(400).json({ message: "Organization required" });
  }

  try {
    const optionCheck = await pool.query(
      `
      SELECT oqo.question_id, oq.organisation_id 
      FROM onboarding_question_options oqo
      JOIN onboarding_questions oq ON oq.id = oqo.question_id
      WHERE oqo.id = $1
    `,
      [optionId]
    );

    if (optionCheck.rows.length === 0) {
      return res.status(404).json({ message: "Option not found" });
    }

    const option = optionCheck.rows[0];
    if (option.organisation_id !== organisationId) {
      return res.status(403).json({ message: "Access denied" });
    }

    const optionCountCheck = await pool.query(
      "SELECT COUNT(*) as option_count FROM onboarding_question_options WHERE question_id = $1",
      [option.question_id]
    );

    const optionCount = parseInt(optionCountCheck.rows[0].option_count);
    if (optionCount <= 1) {
      return res.status(400).json({
        message:
          "Cannot delete the last option. Questions must have at least one option.",
      });
    }

    const result = await pool.query(
      "DELETE FROM onboarding_question_options WHERE id = $1 RETURNING id",
      [optionId]
    );

    res.json({ message: "Option deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/responses", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }
  const { option_ids } = req.body;
  if (!option_ids || !Array.isArray(option_ids) || option_ids.length === 0) {
    return res.status(400).json({ message: "option_ids array is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM onboarding_responses WHERE user_id = $1", [
      user.userId,
    ]);

    for (const optionId of option_ids) {
      await client.query(
        `
        INSERT INTO onboarding_responses (user_id, option_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, option_id) DO NOTHING
      `,
        [user.userId, optionId]
      );
    }

    await client.query(
      "UPDATE users SET has_completed_onboarding = true WHERE id = $1",
      [user.userId]
    );

    try {
      const {
        getUserPreferences,
        getCoursesFromModules,
        ensureUserEnrolledInCourses,
      } = require("./roadmaps-helpers");

      const preferences = await getUserPreferences(client, user.userId);

      const hasPreferences =
        preferences.skills.length > 0 ||
        preferences.memberChannels.length > 0 ||
        preferences.onboardingChannels.length > 0 ||
        preferences.memberLevels.length > 0 ||
        preferences.onboardingLevels.length > 0;

      if (hasPreferences) {
        let moduleQuery = `SELECT DISTINCT
             mod.id,
             COUNT(DISTINCT ms.skill_id) as matching_skills,
             COALESCE(
               CASE 
                 WHEN cc.channel_id = ANY($2) THEN 5
                 WHEN cc.channel_id = ANY($3) THEN 3
                 WHEN cc.channel_id IS NOT NULL THEN 1 
                 ELSE 0 
               END, 0) as channel_match,
             COALESCE(
               CASE 
                 WHEN cc.level_id = ANY($4) THEN 5
                 WHEN cc.level_id = ANY($5) THEN 3
                 WHEN cc.level_id IS NOT NULL THEN 1 
                 ELSE 0 
               END, 0) as level_match,
             RANDOM() as random_score
           FROM modules mod
           JOIN courses c ON c.id = mod.course_id
           LEFT JOIN module_skills ms ON ms.module_id = mod.id
           LEFT JOIN course_channels cc ON cc.course_id = c.id
           LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $6
           LEFT JOIN module_status mst ON mst.module_id = mod.id AND mst.enrollment_id = e.id
           WHERE c.organisation_id = $1 
             AND (mst.status IS NULL OR mst.status IN ('not_started', 'in_progress'))`;

        let moduleParams = [
          user.organisation.id,
          preferences.memberChannels,
          preferences.onboardingChannels,
          preferences.memberLevels,
          preferences.onboardingLevels,
          user.userId,
        ];

        if (preferences.skills.length > 0) {
          moduleQuery += ` AND ms.skill_id = ANY($7)`;
          moduleParams.push(preferences.skills);
        }

        moduleQuery += ` GROUP BY mod.id, cc.channel_id, cc.level_id
           ORDER BY matching_skills DESC, channel_match DESC, level_match DESC, random_score
           LIMIT 10`;

        const modulesResult = await client.query(moduleQuery, moduleParams);

        if (modulesResult.rows.length > 0) {
          const roadmapResult = await client.query(
            "INSERT INTO roadmaps (user_id, name) VALUES ($1, $2) RETURNING id",
            [user.userId, "My Learning Path"]
          );

          const roadmapId = roadmapResult.rows[0].id;
          const moduleIds = modulesResult.rows.map((row) => row.id);

          const courseIds = await getCoursesFromModules(client, moduleIds);

          if (courseIds.length > 0) {
            await ensureUserEnrolledInCourses(client, user.userId, courseIds);
          }

          for (let i = 0; i < moduleIds.length; i++) {
            await client.query(
              "INSERT INTO roadmap_items (roadmap_id, module_id, position) VALUES ($1, $2, $3)",
              [roadmapId, moduleIds[i], i + 1]
            );
          }

          console.log(
            `Auto-generated roadmap "${roadmapResult.rows[0].name}" with ${moduleIds.length} modules for user ${user.userId}`
          );
        }
      }
    } catch (roadmapError) {
      console.error("Failed to auto-generate roadmap:", roadmapError);
    }

    await client.query("COMMIT");

    res.json({
      message: "Responses submitted successfully",
      roadmapGenerated: true,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.get("/responses", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  if (!isEmployee(user)) {
    return res.status(403).json({ message: "Employee access required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT 
        or.option_id,
        oqo.option_text,
        oqo.skill_id,
        s.name as skill_name,
        s.description as skill_description,
        oqo.channel_id,
        ch.name as channel_name,
        ch.description as channel_description,
        oqo.level_id,
        l.name as level_name,
        l.description as level_description,
        l.sort_order as level_sort_order,
        oq.question_text,
        oq.id as question_id
      FROM onboarding_responses or
      JOIN onboarding_question_options oqo ON oqo.id = or.option_id
      JOIN onboarding_questions oq ON oq.id = oqo.question_id
      LEFT JOIN skills s ON s.id = oqo.skill_id
      LEFT JOIN channels ch ON ch.id = oqo.channel_id
      LEFT JOIN levels l ON l.id = oqo.level_id
      WHERE or.user_id = $1
      ORDER BY oq.position ASC
    `,
      [user.userId]
    );

    const responses = result.rows.map((row) => ({
      option_id: row.option_id,
      option_text: row.option_text,
      skill_id: row.skill_id,
      skill_name: row.skill_name,
      skill_description: row.skill_description,
      channel_id: row.channel_id,
      channel_name: row.channel_name,
      channel_description: row.channel_description,
      level_id: row.level_id,
      level_name: row.level_name,
      level_description: row.level_description,
      level_sort_order: row.level_sort_order,
      question_text: row.question_text,
      question_id: row.question_id,
    }));

    res.json({ responses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
