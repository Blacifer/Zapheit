-- migration_065_semantic_cache.sql
-- Semantic response cache for LLM gateway (pgvector cosine similarity)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS semantic_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id        uuid REFERENCES ai_agents(id) ON DELETE CASCADE,
  model           text NOT NULL,
  prompt_hash     text NOT NULL,              -- SHA-256 of canonical prompt text
  prompt_embedding vector(1536),              -- OpenAI text-embedding-3-small
  prompt_text     text NOT NULL,              -- first 2000 chars for audit
  response_json   jsonb NOT NULL,             -- full ChatCompletion response
  input_tokens    integer DEFAULT 0,
  output_tokens   integer DEFAULT 0,
  hit_count       integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_hit_at     timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

-- Fast exact-match lookup by hash
CREATE UNIQUE INDEX IF NOT EXISTS semantic_cache_hash_idx
  ON semantic_cache (organization_id, model, prompt_hash);

-- pgvector cosine similarity index (IVFFlat — fast approximate nearest neighbour)
CREATE INDEX IF NOT EXISTS semantic_cache_embedding_idx
  ON semantic_cache USING ivfflat (prompt_embedding vector_cosine_ops)
  WITH (lists = 100);

-- TTL cleanup index
CREATE INDEX IF NOT EXISTS semantic_cache_expires_idx
  ON semantic_cache (expires_at);

-- Row-level security
ALTER TABLE semantic_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can read their cache" ON semantic_cache;
CREATE POLICY "org members can read their cache"
  ON semantic_cache FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()
  ));
