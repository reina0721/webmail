-- Durable native-client writes: an ambiguous response is never blindly replayed.
CREATE TABLE native_submissions (
 user_id BLOB NOT NULL REFERENCES platform_users(id),
 request_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','complete','unknown')),
 response TEXT,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,request_id)
);
CREATE TABLE client_preferences (
 user_id BLOB PRIMARY KEY REFERENCES platform_users(id),
 payload TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
