-- Private SMTP gateway state is independent from registration policy and health.
CREATE TABLE automatic_gateway_services (
 service_id TEXT PRIMARY KEY REFERENCES mail_services(id),
 configuration BLOB NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('preparing','ready')),
 updated_at INTEGER NOT NULL
);
CREATE TABLE automatic_gateway_proofs (
 service_id TEXT NOT NULL REFERENCES mail_services(id),
 domain TEXT NOT NULL,
 user_id BLOB REFERENCES platform_users(id),
 owner_email TEXT,
 public_key TEXT NOT NULL,
 private_key BLOB NOT NULL,
 upstream_domain TEXT,
 upstream_signer TEXT,
 PRIMARY KEY(service_id,domain),
 UNIQUE(service_id,user_id)
);
CREATE TABLE automatic_gateway_spool (
 id TEXT PRIMARY KEY,
 service_id TEXT NOT NULL REFERENCES mail_services(id),
 user_id BLOB REFERENCES platform_users(id),
 envelope BLOB NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','delivering','unknown','delivered','rejected')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL,
 error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX automatic_gateway_due ON automatic_gateway_spool(status,next_attempt);
