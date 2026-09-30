-- Additive/idempotent. Does not alter or remove existing memories.
CREATE TABLE IF NOT EXISTS notification_settings (
 user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 timezone text NOT NULL DEFAULT 'UTC', timezone_initialized boolean NOT NULL DEFAULT false,
 push_enabled boolean NOT NULL DEFAULT false, email_enabled boolean NOT NULL DEFAULT false,
 daily_brief_enabled boolean NOT NULL DEFAULT false, daily_brief_time text NOT NULL DEFAULT '08:00',
 quiet_hours_start text NOT NULL DEFAULT '22:00', quiet_hours_end text NOT NULL DEFAULT '07:00',
 remind_appointments boolean NOT NULL DEFAULT true, remind_tasks boolean NOT NULL DEFAULT true,
 remind_expiries boolean NOT NULL DEFAULT true, remind_suggestions boolean NOT NULL DEFAULT true,
 default_lead_days integer[] NOT NULL DEFAULT '{7,1}', hide_details boolean NOT NULL DEFAULT true,
 suspended boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 endpoint text NOT NULL UNIQUE, p256dh text NOT NULL, auth text NOT NULL, session_id text NOT NULL,
 user_agent text, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_owner ON push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS memory_reminder_settings (
 memory_id integer PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 mode text NOT NULL DEFAULT 'automatic' CHECK(mode IN ('automatic','none','lead_times','specific')),
 lead_minutes integer[] NOT NULL DEFAULT '{}', specific_at timestamptz,
 FOREIGN KEY(user_id,memory_id) REFERENCES memories(user_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reminders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 memory_id integer NOT NULL, kind text NOT NULL CHECK(kind IN ('appointment','task','expiry','custom')),
 fire_at timestamptz NOT NULL, event_at timestamptz, original_fire_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','snoozed','done','dismissed')),
 sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,memory_id) REFERENCES memories(user_id,id) ON DELETE CASCADE,
 UNIQUE(memory_id,kind,fire_at)
);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders(fire_at) WHERE status IN ('pending','snoozed');
CREATE INDEX IF NOT EXISTS reminders_owner ON reminders(user_id,memory_id);
-- Delivery claims intentionally outlive logout and notification dismissal.
CREATE TABLE IF NOT EXISTS reminder_delivery_claims (
 memory_id integer NOT NULL, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL, fire_at timestamptz NOT NULL, claimed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(memory_id,kind,fire_at),
 FOREIGN KEY(user_id,memory_id) REFERENCES memories(user_id,id) ON DELETE CASCADE
);
-- Minimal terminal tombstones share the dedup ledger; no notification content.
ALTER TABLE reminder_delivery_claims ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'delivery';
INSERT INTO reminder_delivery_claims(user_id,memory_id,kind,fire_at,reason)
 SELECT user_id,memory_id,kind,fire_at,status FROM reminders WHERE status IN ('done','dismissed')
 UNION ALL
 SELECT user_id,memory_id,kind,original_fire_at,status FROM reminders WHERE status IN ('done','dismissed')
 ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS reminder_recompute_jobs (
 memory_id integer PRIMARY KEY, user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 generation bigint NOT NULL DEFAULT 1, queued_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,memory_id) REFERENCES memories(user_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 memory_id integer, reminder_id uuid, title text NOT NULL, body text NOT NULL, url text NOT NULL,
 kind text NOT NULL, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 delivery_status text NOT NULL DEFAULT 'claimed', delivered_devices integer NOT NULL DEFAULT 0,
 FOREIGN KEY(user_id,memory_id) REFERENCES memories(user_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS notifications_owner ON notifications(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS notification_daily_ledger (
 user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, local_day date NOT NULL,
 used integer NOT NULL DEFAULT 0 CHECK(used BETWEEN 0 AND 6), summary_sent boolean NOT NULL DEFAULT false,
 brief_claimed boolean NOT NULL DEFAULT false, suggestion_claimed boolean NOT NULL DEFAULT false,
 overflow_count integer NOT NULL DEFAULT 0, PRIMARY KEY(user_id,local_day)
);
CREATE TABLE IF NOT EXISTS notification_suggestion_claims (
 user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, fingerprint text NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,fingerprint)
);
-- Serialize delivery with changes/deletion, including voice extraction SQL.
CREATE OR REPLACE FUNCTION notification_owner_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner varchar;
BEGIN
 IF TG_TABLE_NAME='users' THEN owner:=OLD.id;
 ELSIF TG_OP='DELETE' THEN owner:=OLD.user_id;
 ELSE owner:=NEW.user_id; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner,768006));
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS memories_notification_fence ON memories;
CREATE TRIGGER memories_notification_fence BEFORE UPDATE OR DELETE ON memories FOR EACH ROW EXECUTE FUNCTION notification_owner_fence();
DROP TRIGGER IF EXISTS users_notification_fence ON users;
CREATE TRIGGER users_notification_fence BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION notification_owner_fence();
CREATE OR REPLACE FUNCTION queue_reminder_recompute() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW.is_sample OR (TG_OP='UPDATE' AND NOT OLD.is_sample) THEN
  INSERT INTO reminder_recompute_jobs(memory_id,user_id) VALUES(NEW.id,NEW.user_id)
  ON CONFLICT(memory_id) DO UPDATE SET generation=reminder_recompute_jobs.generation+1,queued_at=now();
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS memories_reminder_queue ON memories;
CREATE TRIGGER memories_reminder_queue AFTER INSERT OR UPDATE OF event_date,extra,type,is_sample ON memories
 FOR EACH ROW EXECUTE FUNCTION queue_reminder_recompute();
CREATE TABLE IF NOT EXISTS notification_migration_state (
 key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
WITH first_application AS (
 INSERT INTO notification_migration_state(key) VALUES('006-bootstrap') ON CONFLICT DO NOTHING RETURNING key
)
INSERT INTO reminder_recompute_jobs(memory_id,user_id)
 SELECT id,user_id FROM memories WHERE NOT is_sample AND EXISTS(SELECT 1 FROM first_application)
 ON CONFLICT(memory_id) DO NOTHING;