ALTER TABLE native_submissions ADD COLUMN semantic_hash TEXT NOT NULL DEFAULT '';
-- A retried composer may generate another Message-ID/request ID. An unresolved
-- equivalent send must still be checked before another can enter the MTA.
CREATE UNIQUE INDEX native_unresolved_submission ON native_submissions(user_id,semantic_hash)
 WHERE semantic_hash<>'' AND status IN ('pending','unknown')
 AND (outcome IS NULL OR json_extract(outcome,'$.state')<>'accepted');
