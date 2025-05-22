const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../database/db");
const router = express.Router();

function setAuthCookie(res, payload) {
  res.cookie("auth", JSON.stringify(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

// SIGN UP → POST /api/signup
router.post("/signup", async (req, res) => {
  const { email, password, firstname = "", lastname = "" } = req.body;
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

// LOG IN → POST /api/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT id, password_hash, firstname, lastname
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
    setAuthCookie(res, {
      userId: u.id,
      email,
      firstname: u.firstname,
      lastname: u.lastname,
      isLoggedIn: true,
    });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// LOGOUT → POST /api/logout
router.post("/logout", (req, res) => {
  res.clearCookie("auth", { path: "/" }).json({ success: true });
});

// WHOAMI → GET /api/me
router.get("/me", (req, res) => {
  const { auth } = req.cookies;
  if (!auth) return res.json({ isLoggedIn: false });
  try {
    return res.json(JSON.parse(auth));
  } catch {
    return res.json({ isLoggedIn: false });
  }
});

module.exports = router;
