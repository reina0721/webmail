-- Persist site branding, icons, SEO metadata, auth page appearance, and uploaded visual assets.
CREATE TABLE site_assets (
    kind TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at INTEGER NOT NULL
);
