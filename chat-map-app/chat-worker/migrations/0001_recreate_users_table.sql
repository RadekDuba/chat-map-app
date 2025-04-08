-- Migration number: 0001 	 2025-04-08_recreate.sql
-- Re-attempt Create Users Table

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,            -- Using TEXT for UUIDs or similar unique IDs
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    age INTEGER,
    gender TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Index email and username for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
