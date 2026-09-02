-- Migration: 003_create_files_table
-- Description: Creates the consolidated files table with non-unique storage_key, hidden status, tracking, and GIN search index

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
    last_opened_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance and search indexes
CREATE INDEX IF NOT EXISTS files_name_idx ON public.files (name);
CREATE INDEX IF NOT EXISTS files_owner_id_idx ON public.files (owner_id);
CREATE INDEX IF NOT EXISTS files_folder_id_idx ON public.files (folder_id);
CREATE INDEX IF NOT EXISTS files_owner_name_idx ON public.files (owner_id, name);
CREATE INDEX IF NOT EXISTS files_name_gin_idx ON public.files USING GIN (to_tsvector('simple', name));
