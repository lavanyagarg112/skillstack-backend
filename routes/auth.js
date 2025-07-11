const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../database/db");
const router = express.Router();
const logActivity = require("./activityLogger");

function setAuthCookie(res, payload) {
  res.cookie("auth", JSON.stringify(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

router.post("/signup", async (req, res) => {
  const { email, password, firstname, lastname } = req.body;
  if (password.length < 8) {
    return res
      .status(400)
      .json({ message: "Password must be at least 8 characters long" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, firstname, lastname)
       VALUES ($1,$2,$3,$4)
       RETURNING id, firstname, lastname`,
      [email, hash, firstname, lastname]
    );
    const user = result.rows[0];

    setAuthCookie(res, {
      userId: user.id,
      email,
      firstname: user.firstname,
      lastname: user.lastname,
      isLoggedIn: true,
      hasCompletedOnboarding: false,
      organisation: null,
    });
    return res.status(201).json({ success: true });
  } catch (err) {
    console.error(err);
    if (err.code === "23505") {
      return res.status(400).json({ message: "Email already registered" });
    }
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT id, password_hash, firstname, lastname, has_completed_onboarding
       FROM users WHERE email = $1`,
      [email]
    );
    if (
      !rows.length ||
      !(await bcrypt.compare(password, rows[0].password_hash))
    ) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const u = rows[0];
    const mem = await pool.query(
      `SELECT
     o.id                    AS id,
     o.organisation_name     AS organisationname,
      o.ai_enabled            AS ai_enabled,
     ou.role                 AS role
   FROM organisation_users ou
   JOIN organisations o
     ON o.id = ou.organisation_id
   WHERE ou.user_id = $1`,
      [u.id]
    );

    const organisation = mem.rows[0] || null;
    setAuthCookie(res, {
      userId: u.id,
      email,
      firstname: u.firstname,
      lastname: u.lastname,
      isLoggedIn: true,
      hasCompletedOnboarding: u.has_completed_onboarding,
      organisation,
    });
    await logActivity({
      userId: u.id,
      organisationId: organisation ? organisation.id : null,
      action: "login",
      metadata: { email },
      displayMetadata: { email },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/logout", async (req, res) => {
  const session = JSON.parse(req.cookies.auth || "{}");
  res.clearCookie("auth", { path: "/" }).json({ success: true });
  await logActivity({
    userId: session.userId,
    organisationId: session.organisation ? session.organisation.id : null,
    action: "logout",
  });
});

router.get("/me", (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.json({ isLoggedIn: false });
  try {
    return res.json(JSON.parse(auth));
  } catch {
    return res.json({ isLoggedIn: false });
  }
});

router.post("/complete-onboarding", async (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.status(401).json({ message: "Not logged in" });

  let user;
  try {
    user = JSON.parse(auth);
  } catch {
    return res.status(400).json({ message: "Bad session" });
  }

  try {
    const mem = await pool.query(
      `SELECT
     o.id                    AS id,
     o.organisation_name     AS organisationname,
      o.ai_enabled            AS ai_enabled,
     ou.role                 AS role
   FROM organisation_users ou
   JOIN organisations o
     ON o.id = ou.organisation_id
   WHERE ou.user_id = $1`,
      [user.userId]
    );

    const organisation = mem.rows[0] || null;

    if (organisation && organisation.role === "employee") {
      const questionCheck = await pool.query(
        `SELECT COUNT(*) as question_count FROM onboarding_questions WHERE organisation_id = $1`,
        [organisation.id]
      );

      const hasQuestions = parseInt(questionCheck.rows[0].question_count) > 0;

      if (hasQuestions) {
        const responseCheck = await pool.query(
          `SELECT COUNT(*) as response_count FROM onboarding_responses WHERE user_id = $1`,
          [user.userId]
        );

        if (parseInt(responseCheck.rows[0].response_count) === 0) {
          return res.status(400).json({
            message: "Onboarding questionnaire must be completed first",
          });
        }
      }
    }

    await pool.query(
      `UPDATE users SET has_completed_onboarding = true WHERE id = $1`,
      [user.userId]
    );

    setAuthCookie(res, {
      ...user,
      hasCompletedOnboarding: true,
      organisation: organisation,
    });

    await logActivity({
      userId: user.userId,
      organisationId: organisation ? organisation.id : null,
      action: "complete_onboarding",
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
