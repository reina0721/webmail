ALTER TABLE native_submissions ADD COLUMN context TEXT NOT NULL DEFAULT '[]';
ALTER TABLE native_submissions ADD COLUMN outcome TEXT;
ALTER TABLE native_submissions ADD COLUMN checked_at INTEGER;
CREATE INDEX native_submissions_recent ON native_submissions(user_id,created_at DESC);
