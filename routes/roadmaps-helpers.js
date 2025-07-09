async function getUserPreferences(client, userId) {
  try {
    const memberChannelsResult = await client.query(
      "SELECT channel_id FROM user_channels WHERE user_id = $1",
      [userId]
    );
    const memberChannels = memberChannelsResult.rows.map(
      (row) => row.channel_id
    );

    const memberLevelsResult = await client.query(
      "SELECT level_id FROM user_levels WHERE user_id = $1",
      [userId]
    );
    const memberLevels = memberLevelsResult.rows.map((row) => row.level_id);

    const skillsResult = await client.query(
      `SELECT DISTINCT oqo.skill_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.skill_id IS NOT NULL`,
      [userId]
    );
    const skills = skillsResult.rows.map((row) => row.skill_id);

    const onboardingChannelsResult = await client.query(
      `SELECT DISTINCT oqo.channel_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.channel_id IS NOT NULL`,
      [userId]
    );
    const onboardingChannels = onboardingChannelsResult.rows.map(
      (row) => row.channel_id
    );

    const onboardingLevelsResult = await client.query(
      `SELECT DISTINCT oqo.level_id
       FROM onboarding_responses or_table
       JOIN onboarding_question_options oqo ON oqo.id = or_table.option_id
       WHERE or_table.user_id = $1 AND oqo.level_id IS NOT NULL`,
      [userId]
    );
    const onboardingLevels = onboardingLevelsResult.rows.map(
      (row) => row.level_id
    );

    return {
      skills,
      memberChannels,
      memberLevels,
      onboardingChannels,
      onboardingLevels,
      channels: {
        all: [...memberChannels, ...onboardingChannels],
        member: memberChannels,
        onboarding: onboardingChannels,
      },
      levels: {
        all: [...memberLevels, ...onboardingLevels],
        member: memberLevels,
        onboarding: onboardingLevels,
      },
    };
  } catch (error) {
    console.error("Error getting user preferences:", error);
    return {
      skills: [],
      memberChannels: [],
      memberLevels: [],
      onboardingChannels: [],
      onboardingLevels: [],
      channels: {
        all: [],
        member: [],
        onboarding: [],
      },
      levels: {
        all: [],
        member: [],
        onboarding: [],
      },
    };
  }
}

async function getCoursesFromModules(client, moduleIds) {
  if (moduleIds.length === 0) return [];

  const result = await client.query(
    "SELECT DISTINCT course_id FROM modules WHERE id = ANY($1)",
    [moduleIds]
  );
  return result.rows.map((row) => row.course_id);
}

async function ensureUserEnrolledInCourses(client, userId, courseIds) {
  if (courseIds.length === 0) return [];

  const enrolledCourses = [];

  for (const courseId of courseIds) {
    const enrollmentResult = await client.query(
      `INSERT INTO enrollments (user_id, course_id, status)
       VALUES ($1, $2, 'enrolled')
       ON CONFLICT (user_id, course_id) DO NOTHING
       RETURNING id`,
      [userId, courseId]
    );

    if (enrollmentResult.rows.length > 0) {
      enrolledCourses.push(courseId);
    }

    const modulesResult = await client.query(
      "SELECT id FROM modules WHERE course_id = $1",
      [courseId]
    );

    for (const moduleRow of modulesResult.rows) {
      const enrollmentIdResult = await client.query(
        "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2",
        [userId, courseId]
      );

      if (enrollmentIdResult.rows.length > 0) {
        const enrollmentId = enrollmentIdResult.rows[0].id;

        await client.query(
          `INSERT INTO module_status (enrollment_id, module_id, status)
           VALUES ($1, $2, 'not_started')
           ON CONFLICT (enrollment_id, module_id) DO NOTHING`,
          [enrollmentId, moduleRow.id]
        );
      }
    }
  }

  return enrolledCourses;
}

module.exports = {
  getUserPreferences,
  getCoursesFromModules,
  ensureUserEnrolledInCourses,
};
