-- Migration 048: Conversation ratings (CSAT)
-- Adds thumbs up/down rating and optional feedback text to conversations.
-- Pattern: same as agent_jobs.feedback SMALLINT (migration_025).

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating IN (1, -1)),
  ADD COLUMN IF NOT EXISTS feedback_text TEXT;

-- 1 = thumbs up, -1 = thumbs down, NULL = not yet rated
COMMENT ON COLUMN conversations.rating IS '1 = thumbs up, -1 = thumbs down, NULL = unrated';
COMMENT ON COLUMN conversations.feedback_text IS 'Optional free-text feedback from the employee';

CREATE INDEX IF NOT EXISTS idx_conversations_rating
  ON conversations(rating)
  WHERE rating IS NOT NULL;
