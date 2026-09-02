-- Migration: 001_create_users_table
-- Description: Creates the consolidated users table with auth, verification, reset token, and secret code fields

CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    image_url TEXT,
    password_hash TEXT,
    is_verified BOOLEAN DEFAULT false,
    verification_token TEXT,
    reset_password_token TEXT,
    reset_password_expires TIMESTAMPTZ,
    secret_code TEXT DEFAULT NULL,
    current_challenge TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on email column for fast lookups
CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);
