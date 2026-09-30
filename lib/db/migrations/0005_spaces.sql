-- Additive, idempotent; no existing memory or connection is changed.
CREATE UNIQUE INDEX IF NOT EXISTS memories_owner_identity ON memories(user_id,id);
CREATE TABLE IF NOT EXISTS spaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('project','person','trip','topic')),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 description text,
 icon text NOT NULL CHECK(icon IN ('briefcase','user','plane','hash','heart','book','sparkles','map')),
 color text NOT NULL DEFAULT 'gold' CHECK(color IN ('gold','amber','bronze','sand')),
 pinned boolean NOT NULL DEFAULT false,
 archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,id)
);
CREATE INDEX IF NOT EXISTS spaces_owner ON spaces(user_id,archived);
CREATE TABLE IF NOT EXISTS space_memories (
 space_id uuid NOT NULL,
 memory_id integer NOT NULL,
 user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source text NOT NULL CHECK(source IN ('ai','manual')),
 status text NOT NULL CHECK(status IN ('suggested','confirmed','dismissed')),
 reason text NOT NULL DEFAULT '',
 confidence integer NOT NULL DEFAULT 100 CHECK(confidence BETWEEN 0 AND 100),
 PRIMARY KEY(space_id,memory_id),
 FOREIGN KEY(user_id,space_id) REFERENCES spaces(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,memory_id) REFERENCES memories(user_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS space_memories_owner_memory ON space_memories(user_id,memory_id,status);
CREATE TABLE IF NOT EXISTS space_creation_suggestions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('project','person','trip','topic')),
 name text NOT NULL,
 normalized_name text NOT NULL,
 reason text NOT NULL,
 status text NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested','confirmed','dismissed')),
 space_id uuid REFERENCES spaces(id) ON DELETE SET NULL,
 UNIQUE(user_id,normalized_name)
);
CREATE TABLE IF NOT EXISTS space_profile_hidden (
 user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 space_id uuid NOT NULL,
 item_id text NOT NULL,
 PRIMARY KEY(space_id,item_id),
 FOREIGN KEY(user_id,space_id) REFERENCES spaces(user_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS space_matching_jobs (
 memory_id integer PRIMARY KEY,
 user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version bigint NOT NULL,
 generation bigint NOT NULL DEFAULT 1,
 completed boolean NOT NULL DEFAULT false,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 lease_token text,
 last_error text,
 FOREIGN KEY(user_id,memory_id) REFERENCES memories(user_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS space_matching_due ON space_matching_jobs(next_attempt_at) WHERE NOT completed;
CREATE OR REPLACE FUNCTION space_terminal_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='dismissed' AND NEW.status<>'dismissed' THEN
  RAISE EXCEPTION 'Dismissed space suggestion is terminal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS space_memories_terminal ON space_memories;
CREATE TRIGGER space_memories_terminal BEFORE UPDATE ON space_memories FOR EACH ROW EXECUTE FUNCTION space_terminal_status();
DROP TRIGGER IF EXISTS space_creation_terminal ON space_creation_suggestions;
CREATE TRIGGER space_creation_terminal BEFORE UPDATE ON space_creation_suggestions FOR EACH ROW EXECUTE FUNCTION space_terminal_status();
CREATE OR REPLACE FUNCTION queue_space_matching() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  DELETE FROM space_memories WHERE user_id=NEW.user_id AND memory_id=NEW.id AND source='ai' AND status='suggested';
 END IF;
 INSERT INTO space_matching_jobs(memory_id,user_id,version)
 SELECT NEW.id,NEW.user_id,version FROM memory_embedding_jobs WHERE memory_id=NEW.id
 ON CONFLICT(memory_id) DO UPDATE SET version=EXCLUDED.version,generation=space_matching_jobs.generation+1,
 completed=false,attempts=0,next_attempt_at=now(),lease_until=NULL,lease_token=NULL,last_error=NULL;
 RETURN NEW;
END $$;
-- z suffix guarantees the existing embedding queue runs first.
DROP TRIGGER IF EXISTS memories_z_queue_spaces ON memories;
CREATE TRIGGER memories_z_queue_spaces AFTER INSERT OR UPDATE OF title,summary,raw_text,transcript,type,tags,people,event_date,amount,currency,extra
 ON memories FOR EACH ROW EXECUTE FUNCTION queue_space_matching();
INSERT INTO space_matching_jobs(memory_id,user_id,version)
 SELECT m.id,m.user_id,j.version FROM memories m JOIN memory_embedding_jobs j ON j.memory_id=m.id
 ON CONFLICT DO NOTHING;
-- Reindex/model changes update embedding jobs rather than memory content. Keep
-- matching versions in sync without changing existing embedding/connection logic.
CREATE OR REPLACE FUNCTION space_embedding_ready() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.version<>OLD.version OR (NEW.indexed_version=NEW.version AND NEW.indexed_version<>OLD.indexed_version) THEN
  INSERT INTO space_matching_jobs(memory_id,user_id,version)
   SELECT m.id,m.user_id,NEW.version FROM memories m WHERE m.id=NEW.memory_id
  ON CONFLICT(memory_id) DO UPDATE SET version=EXCLUDED.version,generation=space_matching_jobs.generation+1,
   completed=false,attempts=0,next_attempt_at=now(),lease_until=NULL,lease_token=NULL,last_error=NULL;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS embedding_queue_spaces ON memory_embedding_jobs;
CREATE TRIGGER embedding_queue_spaces AFTER UPDATE OF version,indexed_version ON memory_embedding_jobs
 FOR EACH ROW EXECUTE FUNCTION space_embedding_ready();