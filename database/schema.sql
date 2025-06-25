BEGIN;

-- 1. USERS
CREATE TABLE users (
  id                        SERIAL PRIMARY KEY,
  email                     VARCHAR(255)    NOT NULL UNIQUE,
  password_hash             VARCHAR(255)    NOT NULL,
  firstname                 VARCHAR(100) NOT NULL,
  lastname                  VARCHAR(100) NOT NULL,
  created_at                TIMESTAMPTZ     NOT NULL DEFAULT now(),
  has_completed_onboarding  BOOLEAN         NOT NULL DEFAULT FALSE
);

-- 2. ORGANISATIONS
CREATE TABLE organisations (
  id                  SERIAL PRIMARY KEY,
  organisation_name   VARCHAR(100)    NOT NULL,
  admin_user_id       INTEGER         UNIQUE NOT NULL
    REFERENCES users(id) ON DELETE NO ACTION,
  description         TEXT            NOT NULL DEFAULT '',
  ai_enabled          BOOLEAN         NOT NULL DEFAULT FALSE,
  current_invitation_id TEXT UNIQUE,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  UNIQUE(organisation_name, admin_user_id)
);

-- 3. ORGANISATION_USERS
CREATE TABLE organisation_users (
  user_id         INTEGER      NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  organisation_id INTEGER      NOT NULL
    REFERENCES organisations(id) ON DELETE CASCADE,
  role            VARCHAR(10)  NOT NULL
    CHECK (role IN ('admin', 'moderator', 'employee')),
  PRIMARY KEY(user_id, organisation_id)
);


-- 4. COURSES & ENROLLMENTS
CREATE TABLE courses (
  id              SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL
    REFERENCES organisations(id) ON DELETE CASCADE,
  name            VARCHAR(255)    NOT NULL,
  description     TEXT,
  created_by      INTEGER
    REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  UNIQUE(organisation_id, name)
);

CREATE TABLE enrollments (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER    NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  course_id     INTEGER    NOT NULL
    REFERENCES courses(id) ON DELETE CASCADE,
  status        VARCHAR(50) NOT NULL DEFAULT 'enrolled',
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  UNIQUE(user_id, course_id)
);

CREATE TABLE module_status (
  id            SERIAL PRIMARY KEY,
  enrollment_id INTEGER    NOT NULL
    REFERENCES enrollments(id) ON DELETE CASCADE,
  module_id     INTEGER    NOT NULL
    REFERENCES modules(id) ON DELETE CASCADE,
  status        VARCHAR(50) NOT NULL DEFAULT 'not_started', -- 'not_started', 'in_progress', 'completed'
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  UNIQUE(enrollment_id, module_id)
);


-- 5. MODULES & REVISIONS
CREATE TABLE modules (
  id            SERIAL PRIMARY KEY,
  course_id     INTEGER    NOT NULL
    REFERENCES courses(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  module_type   VARCHAR(50)  NOT NULL,    -- e.g. 'video', 'quiz', 'pdf'
  description   TEXT,
  position      INTEGER      NOT NULL DEFAULT 0,
  file_url      TEXT
);

CREATE TABLE revisions (
  id              SERIAL PRIMARY KEY,
  module_id       INTEGER NOT NULL
    REFERENCES modules(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(module_id, revision_number)
);


-- 6. MATERIALS & SKILLS
CREATE TABLE materials (
  id            SERIAL PRIMARY KEY,
  revision_id   INTEGER    NOT NULL
    REFERENCES revisions(id) ON DELETE CASCADE,
  type          VARCHAR(50) NOT NULL,     -- 'video','pdf','slide',...
  file_url      TEXT        NOT NULL,     -- S3/Cloud URL
  uploaded_by   INTEGER
    REFERENCES users(id) ON DELETE SET NULL,
  upload_date   TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date      TIMESTAMPTZ,
  status        VARCHAR(50) NOT NULL DEFAULT 'active'
);

CREATE TABLE skills (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE material_skills (
  material_id INTEGER NOT NULL
    REFERENCES materials(id) ON DELETE CASCADE,
  skill_id    INTEGER NOT NULL
    REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY(material_id, skill_id)
);


-- 7. QUIZZES, QUESTIONS, OPTIONS & RESPONSES
CREATE TABLE quizzes (
  id          SERIAL PRIMARY KEY,
  revision_id INTEGER    NOT NULL
    REFERENCES revisions(id) ON DELETE CASCADE,
  title       VARCHAR(255) NOT NULL,
  quiz_type   VARCHAR(50)  NOT NULL, -- 'graded', 'ungraded', 'practice'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id            SERIAL PRIMARY KEY,
  quiz_id       INTEGER    NOT NULL
    REFERENCES quizzes(id) ON DELETE CASCADE,
  question_text TEXT       NOT NULL,
  question_type VARCHAR(50) NOT NULL, -- 'multiple_choice','true_false',...
  position      INTEGER    NOT NULL DEFAULT 0
);

CREATE TABLE question_options (
  id           SERIAL PRIMARY KEY,
  question_id  INTEGER    NOT NULL
    REFERENCES questions(id) ON DELETE CASCADE,
  option_text  TEXT       NOT NULL,
  is_correct   BOOLEAN    NOT NULL DEFAULT FALSE
);

-- track each user’s full quiz submission
CREATE TABLE quiz_responses (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER    NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  quiz_id      INTEGER    NOT NULL
    REFERENCES quizzes(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- track each answer within a submission
CREATE TABLE quiz_answers (
  id                 SERIAL PRIMARY KEY,
  response_id        INTEGER NOT NULL
    REFERENCES quiz_responses(id) ON DELETE CASCADE,
  question_id        INTEGER NOT NULL
    REFERENCES questions(id) ON DELETE CASCADE,
  selected_option_id INTEGER
    REFERENCES question_options(id) ON DELETE SET NULL,
  answer_text        TEXT,
  -- UNIQUE(response_id, question_id)
);


-- 8. TAGS
CREATE TABLE tags (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE course_tags (
  course_id INTEGER NOT NULL
    REFERENCES courses(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL
    REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(course_id, tag_id)
);

CREATE TABLE revision_tags (
  revision_id INTEGER NOT NULL
    REFERENCES revisions(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL
    REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(revision_id, tag_id)
);

CREATE TABLE quiz_tags (
  quiz_id INTEGER NOT NULL
    REFERENCES quizzes(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL
    REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(quiz_id, tag_id)
);

CREATE TABLE question_tags (
  question_id INTEGER NOT NULL
    REFERENCES questions(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL
    REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(question_id, tag_id)
);


-- 9. REPORTS
CREATE TABLE reports (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER    NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  report_type  VARCHAR(50)  NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data         JSONB
);


-- 10. LEADERBOARDS
CREATE TABLE leaderboards (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE leaderboard_entries (
  leaderboard_id INTEGER NOT NULL
    REFERENCES leaderboards(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  points         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(leaderboard_id, user_id)
);


-- 11. ROADMAPS
CREATE TABLE roadmaps (
  id       SERIAL PRIMARY KEY,
  user_id  INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  name     VARCHAR(255) NOT NULL
);

CREATE TABLE roadmap_items (
  roadmap_id  INTEGER NOT NULL
    REFERENCES roadmaps(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL
    REFERENCES materials(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  PRIMARY KEY(roadmap_id, material_id)
);

COMMIT;
