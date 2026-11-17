ALTER TABLE registration_readiness ADD COLUMN last_success_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registration_readiness ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registration_readiness ADD COLUMN started_at INTEGER NOT NULL DEFAULT 0;
UPDATE registration_readiness SET last_success_at=checked_at WHERE automatic_ok=1;
