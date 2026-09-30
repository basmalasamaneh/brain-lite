-- Additive and idempotent. pgvector is optional on hosted PostgreSQL.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable; using double precision arrays';
  END;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='memories' AND column_name='embedding') THEN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') THEN
      ALTER TABLE memories ADD COLUMN embedding vector(768);
    ELSE
      ALTER TABLE memories ADD COLUMN embedding double precision[];
    END IF;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
             AND table_name='memories' AND column_name='embedding' AND udt_name='vector') THEN
    CREATE INDEX IF NOT EXISTS memories_embedding_hnsw ON memories USING hnsw (embedding vector_cosine_ops);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS memories_user_event_date ON memories(user_id,event_date);
CREATE TABLE IF NOT EXISTS memory_embedding_jobs (
  memory_id integer PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 1,
  indexed_version bigint NOT NULL DEFAULT 0,
  model text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS memory_embedding_jobs_due ON memory_embedding_jobs(next_attempt_at);
ALTER TABLE memory_embedding_jobs ADD COLUMN IF NOT EXISTS lease_token text;
CREATE OR REPLACE FUNCTION queue_memory_embedding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO memory_embedding_jobs(memory_id) VALUES(NEW.id)
  ON CONFLICT(memory_id) DO UPDATE SET
    version=memory_embedding_jobs.version+1, attempts=0,
    next_attempt_at=now(), lease_until=NULL, lease_token=NULL, last_error=NULL;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='memories_queue_embedding') THEN
    CREATE TRIGGER memories_queue_embedding
    AFTER INSERT OR UPDATE OF title,summary,raw_text,transcript,type,tags,people,event_date,amount,currency,extra
    ON memories FOR EACH ROW EXECUTE FUNCTION queue_memory_embedding();
  END IF;
END $$;
-- One-time backfill: existing jobs (including failures) retain their progress.
INSERT INTO memory_embedding_jobs(memory_id) SELECT id FROM memories ON CONFLICT DO NOTHING;

-- Date-only and floating local times retain their calendar date. Explicit
-- offsets represent instants, and must be converted to the question's timezone.
-- Legacy malformed dates must not make all retrieval fail.
CREATE OR REPLACE FUNCTION brain_memory_local_date(value text, zone text DEFAULT 'UTC')
RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  IF value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RETURN to_char(value::timestamptz AT TIME ZONE zone, 'YYYY-MM-DD');
  ELSIF value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}($|T)' THEN
    RETURN to_char(left(value,10)::date, 'YYYY-MM-DD');
  END IF;
  RETURN NULL;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN NULL;
END $$;