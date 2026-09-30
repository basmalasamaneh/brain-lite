-- Preserve confirmed links and terminal dismissed pairs. Version changes are
-- the same integer fence used by discovery; cancellation happens in the edit
-- transaction, before a stale suggestion can be acted on.
CREATE OR REPLACE FUNCTION invalidate_changed_connections() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version IS DISTINCT FROM OLD.version THEN
    DELETE FROM memory_links
      WHERE user_id=(SELECT user_id FROM memories WHERE id=NEW.memory_id)
        AND source='ai' AND status='suggested'
        AND (memory_a_id=NEW.memory_id OR memory_b_id=NEW.memory_id);
    UPDATE connection_discovery_jobs SET explicit=false,forgotten=false,
      completed=true,generation=generation+1,lease_until=NULL,lease_token=NULL,
      last_error=NULL
      WHERE memory_id=NEW.memory_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS embeddings_invalidate_connections ON memory_embedding_jobs;
CREATE TRIGGER embeddings_invalidate_connections AFTER UPDATE OF version
  ON memory_embedding_jobs FOR EACH ROW EXECUTE FUNCTION invalidate_changed_connections();

-- An explicit request is valid for exactly its requested version/generation.
-- Readiness for that version must not consume it; edits must not inherit it.
CREATE OR REPLACE FUNCTION queue_ready_connections() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id varchar;
BEGIN
  IF NEW.indexed_version = NEW.version AND
    (TG_OP='INSERT' OR OLD.indexed_version IS DISTINCT FROM NEW.indexed_version) THEN
    SELECT user_id INTO owner_id FROM memories WHERE id=NEW.memory_id;
    IF coalesce((SELECT automatic FROM connection_settings WHERE user_id=owner_id),true) THEN
      INSERT INTO connection_discovery_jobs(memory_id,user_id,version)
        VALUES(NEW.memory_id,owner_id,NEW.version)
      ON CONFLICT(memory_id) DO UPDATE SET version=EXCLUDED.version,
        generation=connection_discovery_jobs.generation+1,explicit=false,forgotten=false,
        completed=false,attempts=0,next_attempt_at=now(),
        lease_until=NULL,lease_token=NULL,last_error=NULL
        WHERE connection_discovery_jobs.version<>EXCLUDED.version;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Idempotently retire legacy sticky authorization, not current pending requests.
UPDATE connection_discovery_jobs d SET explicit=false,completed=true,
  generation=generation+1,lease_until=NULL,lease_token=NULL
  FROM memory_embedding_jobs j WHERE j.memory_id=d.memory_id
    AND d.explicit AND (d.completed OR d.version<>j.version);