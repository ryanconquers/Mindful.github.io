-- Add patient/doctor roles while preserving existing participant accounts.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('patient', 'doctor')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  doctor_code TEXT UNIQUE,
  doctor_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS users_doctor_idx ON users (doctor_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  failed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_email_idx ON login_failures (email, failed_at);

ALTER TABLE submissions ADD COLUMN user_id INTEGER;
CREATE INDEX IF NOT EXISTS submissions_user_idx ON submissions (user_id);

-- Old participant accounts are retained as patient accounts. Existing sessions
-- are intentionally not copied because their token hashes use the old format.
INSERT OR IGNORE INTO users (id, email, name, role, password_hash, password_salt, created_at)
SELECT id, email, CASE WHEN instr(email, '@') > 1 THEN substr(email, 1, instr(email, '@') - 1) ELSE email END,
       'patient', replace(replace(password_hash, '-', '+'), '_', '/') || '=',
       replace(replace(password_salt, '-', '+'), '_', '/') || '==', created_at
FROM accounts WHERE email_verified = 1;

UPDATE submissions
SET user_id = (SELECT users.id FROM accounts JOIN users ON users.email = accounts.email
               WHERE accounts.id = submissions.account_id)
WHERE account_id IS NOT NULL;
