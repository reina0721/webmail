-- The browser encrypts the archive; the installation vault also protects it at rest.
CREATE TABLE client_archives (
 user_id BLOB PRIMARY KEY REFERENCES platform_users(id),
 envelope BLOB NOT NULL,
 updated_at INTEGER NOT NULL
);
