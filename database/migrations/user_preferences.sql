-- Migration: Add user channel and level preferences tables
-- Purpose: Allow users to set their preferred channels and levels for personalized recommendations

-- Table for user channel preferences
CREATE TABLE user_channels (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id      INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  preference_rank INTEGER NOT NULL DEFAULT 1,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, channel_id)
);

-- Table for user level preferences  
CREATE TABLE user_levels (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level_id        INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  preference_rank INTEGER NOT NULL DEFAULT 1,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, level_id)
);

-- Indexes for better query performance
CREATE INDEX idx_user_channels_user_id ON user_channels(user_id);
CREATE INDEX idx_user_channels_channel_id ON user_channels(channel_id);
CREATE INDEX idx_user_levels_user_id ON user_levels(user_id);
CREATE INDEX idx_user_levels_level_id ON user_levels(level_id);

-- Comments for documentation
COMMENT ON TABLE user_channels IS 'Stores user preferences for learning channels/topics';
COMMENT ON TABLE user_levels IS 'Stores user preferences for difficulty levels';
COMMENT ON COLUMN user_channels.preference_rank IS 'Ranking of channel preference (1 = highest priority)';
COMMENT ON COLUMN user_levels.preference_rank IS 'Ranking of level preference (1 = highest priority)';