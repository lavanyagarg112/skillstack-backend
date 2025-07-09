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

  // if (!isEmployee(user)) {
  //   return res.status(403).json({ message: "Employee access required" });
  // }

  try {
    const questionsResult = await pool.query(`
      SELECT id, question_text, position 
      FROM onboarding_questions 
      ORDER BY position ASC
    `);

    const questions = [];
    for (const question of questionsResult.rows) {
      const optionsResult = await pool.query(
        `
        SELECT oqo.id, oqo.option_text, oqo.tag_id, t.name as tag_name
        FROM onboarding_question_options oqo
        LEFT JOIN tags t ON t.id = oqo.tag_id
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

  try {
    const result = await pool.query(
      `
      INSERT INTO onboarding_questions (question_text, position)
      VALUES ($1, $2)
      RETURNING id, question_text, position
    `,
      [question_text, position]
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
  const { option_text, tag_id } = req.body;

  if (!option_text) {
    return res.status(400).json({ message: "option_text is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const questionCheck = await client.query(
      "SELECT id FROM onboarding_questions WHERE id = $1",
      [id]
    );
    if (questionCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Question not found" });
    }

    let tagCheck = { rows: [] };
    if (tag_id) {
      tagCheck = await client.query("SELECT id, name FROM tags WHERE id = $1", [
        tag_id,
      ]);
      if (tagCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Tag not found" });
      }
    }

    const result = await client.query(
      `
      INSERT INTO onboarding_question_options (question_id, option_text, tag_id)
      VALUES ($1, $2, $3)
      RETURNING id, option_text, tag_id
    `,
      [id, option_text, tag_id || null]
    );

    await client.query("COMMIT");

    const option = {
      ...result.rows[0],
      tag_name: tag_id ? tagCheck.rows[0].name : null,
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

  try {
    const result = await pool.query(
      "DELETE FROM onboarding_questions WHERE id = $1 RETURNING id",
      [id]
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

    await client.query("COMMIT");

    res.json({ message: "Responses submitted successfully" });
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
        oqo.tag_id,
        t.name as tag_name,
        oq.question_text,
        oq.id as question_id
      FROM onboarding_responses or
      JOIN onboarding_question_options oqo ON oqo.id = or.option_id
      JOIN onboarding_questions oq ON oq.id = oqo.question_id
      LEFT JOIN tags t ON t.id = oqo.tag_id
      WHERE or.user_id = $1
      ORDER BY oq.position ASC
    `,
      [user.userId]
    );

    const responses = result.rows.map((row) => ({
      option_id: row.option_id,
      option_text: row.option_text,
      tag_id: row.tag_id,
      tag_name: row.tag_name,
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
