-- Optional patient advice and doctor review metadata for account check-ins.
ALTER TABLE submissions ADD COLUMN ai_advice TEXT;
ALTER TABLE submissions ADD COLUMN ai_status TEXT;
ALTER TABLE submissions ADD COLUMN ai_source TEXT;
ALTER TABLE submissions ADD COLUMN review_verdict TEXT;
ALTER TABLE submissions ADD COLUMN review_notes TEXT;
ALTER TABLE submissions ADD COLUMN reviewed_by INTEGER;
ALTER TABLE submissions ADD COLUMN reviewed_at TEXT;
