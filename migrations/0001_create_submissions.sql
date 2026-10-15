CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submitted_at TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  mood_score INTEGER NOT NULL,
  mood_band TEXT NOT NULL,
  anxiety_score INTEGER NOT NULL,
  anxiety_band TEXT NOT NULL,
  stress_score INTEGER NOT NULL,
  stress_band TEXT NOT NULL,
  experiences_score INTEGER NOT NULL,
  experiences_band TEXT NOT NULL,
  personality_score INTEGER NOT NULL,
  personality_band TEXT NOT NULL,
  functioning_score INTEGER NOT NULL,
  safety_support INTEGER NOT NULL,
  unusual_experience_referral INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS submissions_submitted_at_idx
  ON submissions (submitted_at);
