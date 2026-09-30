-- Run only after the explicitly approved development fresh-start reset.
-- Re-runnable; it does not delete any future registered accounts.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash varchar(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS name varchar(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS language varchar(2) DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme varchar(6) DEFAULT 'system';
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE memories ALTER COLUMN user_id TYPE varchar USING user_id::varchar;
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
ALTER TABLE users ALTER COLUMN name SET NOT NULL;
ALTER TABLE users ALTER COLUMN language SET NOT NULL;
ALTER TABLE users ALTER COLUMN theme SET NOT NULL;
ALTER TABLE users ALTER COLUMN onboarding_completed SET NOT NULL;
ALTER TABLE memories ALTER COLUMN user_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memories_user_id_users_id_fk') THEN
    ALTER TABLE memories ADD CONSTRAINT memories_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploads_user_id_users_id_fk') THEN
    ALTER TABLE uploads DROP CONSTRAINT uploads_user_id_users_id_fk;
  END IF;
  ALTER TABLE uploads ADD CONSTRAINT uploads_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
END $$;
ALTER TABLE users DROP COLUMN IF EXISTS first_name;
ALTER TABLE users DROP COLUMN IF EXISTS last_name;
ALTER TABLE users DROP COLUMN IF EXISTS profile_image_url;
COMMIT;