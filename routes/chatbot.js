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

const axios = require("axios");
const GROQ_API_KEY = process.env.LLM_API_KEY;

async function callLLM(context) {
  const systemPrompt = `
    You are a technical course assistant for an online platform.
    Use the course/module/skills context provided to answer user questions using your expertise,
    as if you are an instructor on that module. Do not mention that you lack material access.
    Do not mention "Since we are in this particular course", just answer the question directly.
    Answer the question as if you are directly talking to the student.
    If unsure, give your best expert guess based on course/module metadata and tags. Keep your answers concise and focused on the question.
    If the question is not related to the course/module, politely redirect them to the appropriate support
  `;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(context, null, 2) },
    { role: "user", content: context.question },
  ];

  const resp = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama3-70b-8192",
      messages,
      temperature: 0.3,
      max_tokens: 512,
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  return resp.data.choices[0].message.content;
}

router.post("/ask", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const userId = user.userId;
  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { courseId, moduleId, question } = req.body;
  if (!courseId || !moduleId) {
    return res
      .status(400)
      .json({ message: "Course and module IDs are required" });
  }
  if (!question || question.trim() === "") {
    return res.status(400).json({ message: "Question is required" });
  }

  try {
    const client = await pool.connect();
    const courseRes = await client.query(
      `SELECT name, description
         FROM courses
         WHERE id = $1`,
      [courseId]
    );
    const course = courseRes.rows[0];
    const moduleRes = await client.query(
      `SELECT title, description
         FROM modules
         WHERE id = $1`,
      [moduleId]
    );
    const module = moduleRes.rows[0];

    const courseSkillsRes = await client.query(
      `SELECT s.id, s.name, s.description
         FROM module_skills ms
         JOIN skills s ON s.id = ms.skill_id
         WHERE ms.module_id = $1`,
      [moduleId]
    );
    const courseSkills =
      courseSkillsRes.rows.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
      })) || [];
    const channelRes = await client.query(
      `SELECT c.id, c.name, c.description
         FROM course_channels cc
         JOIN channels c ON c.id = cc.channel_id
         WHERE cc.course_id = $1`,
      [courseId]
    );
    const channel = channelRes.rows[0] || {
      id: null,
      name: "No channel",
      description: "",
    };

    const levelRes = await client.query(
      `SELECT l.id, l.name, l.description, l.sort_order
         FROM course_channels cc
         JOIN levels l ON l.id = cc.level_id
         WHERE cc.course_id = $1`,
      [courseId]
    );
    const level = levelRes.rows[0] || {
      id: null,
      name: "No level",
      description: "",
      sort_order: 0,
    };

    const context = {
      course_name: course.name,
      course_description: course.description,
      module_name: module.title,
      module_description: module.description,
      channel: {
        id: channel.id,
        name: channel.name,
        description: channel.description,
      },
      level: {
        id: level.id,
        name: level.name,
        description: level.description,
        sort_order: level.sort_order,
      },
      skill_tags: courseSkills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
      question: question,
    };

    const answer = await callLLM(context);

    await client.query(
      `INSERT INTO chat_logs (user_id, organisation_id, course_id, module_id, question, answer)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, organisationId, courseId, moduleId, question, answer]
    );

    await client.release();

    return res.json({ success: true, answer });
  } catch (err) {
    console.error("Error processing question:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/logs", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not authenticated" });
  let user;
  try {
    user = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Invalid session" });
  }
  if (!user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const userId = user.userId;
  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { courseId, moduleId } = req.body;
  if (!courseId || !moduleId) {
    return res
      .status(400)
      .json({ message: "Course and module IDs are required" });
  }
  try {
    const client = await pool.connect();
    const logs = await client.query(
      `SELECT question, answer
               FROM chat_logs
               WHERE user_id = $1 AND organisation_id = $2
                AND course_id = $3 AND module_id = $4
               ORDER BY created_at DESC`,
      [userId, organisationId, courseId, moduleId]
    );
    await client.release();
    return res.json({ success: true, logs: logs.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/history", async (req, res) => {
  const user = getAuthUser(req);
  if (!user || !user.isLoggedIn) {
    return res.status(401).json({ message: "Not logged in" });
  }

  const userId = user.userId;
  const organisationId = user.organisation?.id;
  if (!organisationId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    const client = await pool.connect();
    const logs = await client.query(
      `SELECT cl.id, c.name, m.title, cl.question, cl.answer, cl.created_at
         FROM chat_logs cl, courses c, modules m
         WHERE cl.course_id = c.id and cl.module_id = m.id AND
         cl.user_id = $1 AND cl.organisation_id = $2
         ORDER BY created_at DESC`,
      [userId, organisationId]
    );
    await client.release();
    return res.json({ success: true, logs: logs.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
