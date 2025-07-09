// Shared helper functions for roadmap operations

async function getUserPreferences(client, userId) {
  try {
    // Get user's channel preferences from member settings (highest priority)
    const memberChannelsResult = await client.query(
      "SELECT channel_id FROM user_channels WHERE user_id = $1",
      [userId]
    );
    const memberChannels = memberChannelsResult.rows.map(row => row.channel_id);

    // Get user's level preferences from member settings (highest priority)
    const memberLevelsResult = await client.query(
      "SELECT level_id FROM user_levels WHERE user_id = $1",
      [userId]
    );
    const memberLevels = memberLevelsResult.rows.map(row => row.level_id);

    // Get user's skills from onboarding responses
    const skillsResult = await client.query(
      `SELECT DISTINCT oqo.skill_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.skill_id IS NOT NULL`,
      [userId]
    );
    const skills = skillsResult.rows.map(row => row.skill_id);

    // Get channel preferences from onboarding responses (fallback)
    const onboardingChannelsResult = await client.query(
      `SELECT DISTINCT oqo.channel_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.channel_id IS NOT NULL`,
      [userId]
    );
    const onboardingChannels = onboardingChannelsResult.rows.map(row => row.channel_id);

    // Get level preferences from onboarding responses (fallback)
    const onboardingLevelsResult = await client.query(
      `SELECT DISTINCT oqo.level_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.level_id IS NOT NULL`,
      [userId]
    );
    const onboardingLevels = onboardingLevelsResult.rows.map(row => row.level_id);

    return {
      skills,
      memberChannels,
      memberLevels,
      onboardingChannels,
      onboardingLevels
    };
  } catch (error) {
    console.error('Error getting user preferences:', error);
    return {
      skills: [],
      memberChannels: [],
      memberLevels: [],
      onboardingChannels: [],
      onboardingLevels: []
    };
  }
}

async function getCoursesFromModules(client, moduleIds) {
  if (moduleIds.length === 0) return [];
  
  const result = await client.query(
    "SELECT DISTINCT course_id FROM modules WHERE id = ANY($1)",
    [moduleIds]
  );
  return result.rows.map(row => row.course_id);
}

async function ensureUserEnrolledInCourses(client, userId, courseIds) {
  if (courseIds.length === 0) return;

  for (const courseId of courseIds) {
    // Insert enrollment if it doesn't exist
    await client.query(
      `INSERT INTO enrollments (user_id, course_id, status)
       VALUES ($1, $2, 'enrolled')
       ON CONFLICT (user_id, course_id) DO NOTHING`,
      [userId, courseId]
    );

    // Get all modules for this course and create module_status records
    const modulesResult = await client.query(
      "SELECT id FROM modules WHERE course_id = $1",
      [courseId]
    );

    for (const moduleRow of modulesResult.rows) {
      // Get the enrollment id
      const enrollmentResult = await client.query(
        "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2",
        [userId, courseId]
      );

      if (enrollmentResult.rows.length > 0) {
        const enrollmentId = enrollmentResult.rows[0].id;

        // Create module_status if it doesn't exist
        await client.query(
          `INSERT INTO module_status (enrollment_id, module_id, status)
           VALUES ($1, $2, 'not_started')
           ON CONFLICT (enrollment_id, module_id) DO NOTHING`,
          [enrollmentId, moduleRow.id]
        );
      }
    }
  }
}

module.exports = {
  getUserPreferences,
  getCoursesFromModules,
  ensureUserEnrolledInCourses
};