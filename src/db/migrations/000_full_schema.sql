-- ==========================================
-- Master Database Schema for Media Storage App
-- ==========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
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

CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);

-- 2. FOLDERS TABLE
CREATE TABLE IF NOT EXISTS public.folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    is_deleted BOOLEAN DEFAULT FALSE,
    is_hidden BOOLEAN DEFAULT FALSE,
    last_opened_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS folders_name_idx ON public.folders (name);
CREATE INDEX IF NOT EXISTS folders_owner_id_idx ON public.folders (owner_id);
CREATE INDEX IF NOT EXISTS folders_parent_id_idx ON public.folders (parent_id);
CREATE INDEX IF NOT EXISTS folders_owner_name_idx ON public.folders (owner_id, name);

-- 3. FILES TABLE
CREATE TABLE IF NOT EXISTS public.files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_key TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    version_id UUID,
    checksum TEXT,
    is_deleted BOOLEAN DEFAULT FALSE,
    is_hidden BOOLEAN DEFAULT FALSE,
    is_encrypted BOOLEAN DEFAULT FALSE,
    encryption_iv TEXT,
    encryption_tag TEXT,
    encryption_algo VARCHAR(32) DEFAULT 'AES-256-GCM',
    source_device VARCHAR(32) DEFAULT 'unknown',
    is_device_sync BOOLEAN DEFAULT FALSE,
    last_opened_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS files_name_idx ON public.files (name);
CREATE INDEX IF NOT EXISTS files_owner_id_idx ON public.files (owner_id);
CREATE INDEX IF NOT EXISTS files_folder_id_idx ON public.files (folder_id);
CREATE INDEX IF NOT EXISTS files_owner_name_idx ON public.files (owner_id, name);
CREATE INDEX IF NOT EXISTS files_source_device_idx ON public.files (source_device);
CREATE INDEX IF NOT EXISTS files_is_device_sync_idx ON public.files (is_device_sync);
CREATE INDEX IF NOT EXISTS files_name_gin_idx ON public.files USING GIN (to_tsvector('simple', name));

-- 4. FILE VERSIONS TABLE
CREATE TABLE IF NOT EXISTS public.file_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    storage_key TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS file_versions_file_id_idx ON public.file_versions (file_id);

ALTER TABLE public.files 
DROP CONSTRAINT IF EXISTS fk_files_version_id,
ADD CONSTRAINT fk_files_version_id 
FOREIGN KEY (version_id) 
REFERENCES public.file_versions(id) 
ON DELETE SET NULL;

-- 5. SHARES TABLE
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'share_resource_type') THEN
        CREATE TYPE share_resource_type AS ENUM ('file', 'folder');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'share_role') THEN
        CREATE TYPE share_role AS ENUM ('viewer', 'editor');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type share_resource_type NOT NULL,
    resource_id UUID NOT NULL,
    grantee_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role share_role NOT NULL,
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (resource_type, resource_id, grantee_user_id)
);

CREATE INDEX IF NOT EXISTS shares_grantee_user_id_idx ON public.shares (grantee_user_id);
CREATE INDEX IF NOT EXISTS shares_resource_id_idx ON public.shares (resource_id);
CREATE INDEX IF NOT EXISTS shares_created_by_idx ON public.shares (created_by);
CREATE INDEX IF NOT EXISTS shares_resource_idx ON public.shares (resource_type, resource_id);

-- 6. LINK SHARES & BUNDLE SHARES TABLES
CREATE TABLE IF NOT EXISTS public.link_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type share_resource_type NOT NULL,
    resource_id UUID NOT NULL,
    token TEXT UNIQUE NOT NULL,
    role share_role NOT NULL DEFAULT 'viewer',
    password_hash TEXT,
    expires_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS link_shares_token_idx ON public.link_shares (token);
CREATE INDEX IF NOT EXISTS link_shares_resource_id_idx ON public.link_shares (resource_id);
CREATE INDEX IF NOT EXISTS link_shares_created_by_idx ON public.link_shares (created_by);

CREATE TABLE IF NOT EXISTS public.bundle_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT UNIQUE NOT NULL,
    file_ids JSONB NOT NULL,
    password_hash TEXT,
    expires_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bundle_shares_token_idx ON public.bundle_shares (token);
CREATE INDEX IF NOT EXISTS bundle_shares_created_by_idx ON public.bundle_shares (created_by);

-- 7. STARS TABLE
CREATE TABLE IF NOT EXISTS public.stars (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    resource_type share_resource_type NOT NULL,
    resource_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS stars_user_id_idx ON public.stars (user_id);

-- 8. ACTIVITIES TABLE
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_action') THEN
        CREATE TYPE activity_action AS ENUM ('upload', 'rename', 'delete', 'restore', 'move', 'share', 'download');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    action activity_action NOT NULL,
    resource_type share_resource_type NOT NULL,
    resource_id UUID NOT NULL,
    context JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activities_actor_id_idx ON public.activities (actor_id);
CREATE INDEX IF NOT EXISTS activities_created_at_idx ON public.activities (created_at);
CREATE INDEX IF NOT EXISTS activities_created_at_desc_idx ON public.activities (created_at DESC);

-- 9. PASSKEYS TABLE
CREATE TABLE IF NOT EXISTS public.passkeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    webauthn_user_id TEXT NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    device_type TEXT NOT NULL,
    backed_up BOOLEAN NOT NULL DEFAULT false,
    transports JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON public.passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_credential_id ON public.passkeys(credential_id);

-- 10. USER HIDDEN ITEMS TABLE
CREATE TABLE IF NOT EXISTS public.user_hidden_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    resource_type VARCHAR(20) NOT NULL CHECK (resource_type IN ('file', 'folder')),
    resource_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT user_hidden_items_unique UNIQUE (user_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS user_hidden_items_user_idx ON public.user_hidden_items (user_id);

-- 11. DEVICE SYNC LOGS TABLE
CREATE TABLE IF NOT EXISTS public.device_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_type VARCHAR(32) NOT NULL, -- 'mobile', 'laptop', 'desktop', 'tablet'
    device_name TEXT,
    files_count INT NOT NULL DEFAULT 0,
    total_bytes BIGINT NOT NULL DEFAULT 0,
    sync_folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_sync_logs_user_id_idx ON public.device_sync_logs (user_id);
CREATE INDEX IF NOT EXISTS device_sync_logs_device_type_idx ON public.device_sync_logs (device_type);
