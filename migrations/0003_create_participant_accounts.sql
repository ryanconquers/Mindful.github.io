CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_tokens_account_purpose_idx
  ON account_tokens (account_id, purpose);

CREATE TABLE IF NOT EXISTS account_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_sessions_account_idx
  ON account_sessions (account_id);

ALTER TABLE submissions
  ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS submissions_account_idx
  ON submissions (account_id);
