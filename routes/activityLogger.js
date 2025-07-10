const pool = require("../database/db");

async function logActivity({
  userId,
  organisationId,
  action,
  metadata = {},
  displayMetadata = {},
}) {
  const sql = `
    INSERT INTO activity_logs
      (user_id, organisation_id, action, metadata, display_metadata)
    VALUES ($1, $2, $3, $4, $5)
  `;
  await pool.query(sql, [
    userId,
    organisationId,
    action,
    metadata,
    displayMetadata,
  ]);
}

module.exports = logActivity;
