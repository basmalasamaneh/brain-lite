-- Additive, idempotent, and executed under the startup migration advisory lock.
CREATE UNIQUE INDEX IF NOT EXISTS memories_owner_identity ON memories(user_id,id);
CREATE TABLE IF NOT EXISTS memory_links (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_a_id integer NOT NULL,
  memory_b_id integer NOT NULL,
  source text NOT NULL CHECK(source IN ('ai','manual')),
  status text NOT NULL CHECK(status IN ('suggested','confirmed','dismissed')),
  relation_type text NOT NULL CHECK(relation_type IN ('same_event','same_person','same_project','same_topic','follow_up','duplicate','other')),
  reason text NOT NULL DEFAULT '',
  confidence integer NOT NULL CHECK(confidence BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(memory_a_id < memory_b_id),
  UNIQUE(user_id,memory_a_id,memory_b_id),
  FOREIGN KEY(user_id,memory_a_id) REFERENCES memories(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,memory_b_id) REFERENCES memories(user_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memory_links_owner_status ON memory_links(user_id,status);
CREATE INDEX IF NOT EXISTS memory_links_owner_b ON memory_links(user_id,memory_b_id);
CREATE OR REPLACE FUNCTION protect_dismissed_connection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='dismissed' AND NEW.status<>'dismissed' THEN
    RAISE EXCEPTION 'Dismissed connection pairs are terminal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS memory_links_dismissed_terminal ON memory_links;
CREATE TRIGGER memory_links_dismissed_terminal BEFORE UPDATE OF status ON memory_links
  FOR EACH ROW EXECUTE FUNCTION protect_dismissed_connection();
CREATE TABLE IF NOT EXISTS connection_settings (
  user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  automatic boolean NOT NULL DEFAULT true,
  next_weekly_at timestamptz NOT NULL DEFAULT now(),
  scan_cursor integer NOT NULL DEFAULT 0
);
ALTER TABLE connection_settings ADD COLUMN IF NOT EXISTS scheduler_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE connection_settings ADD COLUMN IF NOT EXISTS scheduler_retry_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE connection_settings ADD COLUMN IF NOT EXISTS scheduler_lease_until timestamptz;
ALTER TABLE connection_settings ADD COLUMN IF NOT EXISTS scheduler_lease_token text;
ALTER TABLE connection_settings ADD COLUMN IF NOT EXISTS last_scheduler_error text;
CREATE TABLE IF NOT EXISTS connection_daily_usage (
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK(used BETWEEN 0 AND 3),
  PRIMARY KEY(user_id,day)
);
CREATE TABLE IF NOT EXISTS ai_usage_limits (
  scope text NOT NULL,
  bucket timestamptz NOT NULL,
  used integer NOT NULL DEFAULT 0,
  PRIMARY KEY(scope,bucket)
);
CREATE TABLE IF NOT EXISTS connection_discovery_jobs (
  memory_id integer PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version bigint NOT NULL,
  generation bigint NOT NULL DEFAULT 1,
  explicit boolean NOT NULL DEFAULT false,
  forgotten boolean NOT NULL DEFAULT false,
  completed boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token text,
  last_error text,
  FOREIGN KEY(user_id,memory_id) REFERENCES memories(user_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS connection_discovery_due ON connection_discovery_jobs(next_attempt_at) WHERE NOT completed;
-- A content edit changes the indexing version. Only a ready, current embedding
-- enqueues automatic discovery, never a stale in-flight embedding result.
CREATE OR REPLACE FUNCTION queue_ready_connections() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id varchar;
BEGIN
  IF NEW.indexed_version = NEW.version AND
    (TG_OP='INSERT' OR OLD.indexed_version IS DISTINCT FROM NEW.indexed_version) THEN
    SELECT user_id INTO owner_id FROM memories WHERE id=NEW.memory_id;
    INSERT INTO connection_discovery_jobs(memory_id,user_id,version)
      VALUES(NEW.memory_id,owner_id,NEW.version)
    ON CONFLICT(memory_id) DO UPDATE SET version=EXCLUDED.version,
      generation=connection_discovery_jobs.generation+1, completed=false,
      attempts=0,next_attempt_at=now(),lease_until=NULL,lease_token=NULL,last_error=NULL
      WHERE connection_discovery_jobs.version<>EXCLUDED.version;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS embeddings_queue_connections ON memory_embedding_jobs;
CREATE TRIGGER embeddings_queue_connections AFTER INSERT OR UPDATE OF indexed_version
  ON memory_embedding_jobs FOR EACH ROW EXECUTE FUNCTION queue_ready_connections();
INSERT INTO connection_discovery_jobs(memory_id,user_id,version)
  SELECT m.id,m.user_id,j.version FROM memories m JOIN memory_embedding_jobs j ON j.memory_id=m.id
  WHERE j.indexed_version=j.version AND m.embedding IS NOT NULL ON CONFLICT DO NOTHING;
-- No legacy manual-link table or field exists in the inspected schema/code.
-- Do not invent or infer manual links from unrelated metadata.