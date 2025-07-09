-- Migration to add channel_id and level_id to onboarding_question_options table
-- This enables channel and level preferences in the onboarding system

BEGIN;

-- Add channel_id and level_id columns to onboarding_question_options table
ALTER TABLE onboarding_question_options 
ADD COLUMN channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
ADD COLUMN level_id INTEGER REFERENCES levels(id) ON DELETE CASCADE;

-- Add indexes for better performance
CREATE INDEX idx_onboarding_question_options_channel_id ON onboarding_question_options(channel_id);
CREATE INDEX idx_onboarding_question_options_level_id ON onboarding_question_options(level_id);

COMMIT;