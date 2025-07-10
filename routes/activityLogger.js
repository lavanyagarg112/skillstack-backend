const pool = require("../database/db");

async function logActivity({ userId, organisationId, action, metadata = {} }) {
  const sql = `
    INSERT INTO activity_logs
      (user_id, organisation_id, action, metadata)
    VALUES ($1, $2, $3, $4)
  `;
  await pool.query(sql, [userId, organisationId, action, metadata]);
}

module.exports = logActivity;
