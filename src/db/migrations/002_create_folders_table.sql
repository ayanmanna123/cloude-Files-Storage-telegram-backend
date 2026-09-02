-- Migration: 002_create_folders_table
-- Description: Creates the consolidated folders table with self-referencing relationship, hidden flag, and tracking fields

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

-- Indexes for performance on frequently queried columns
CREATE INDEX IF NOT EXISTS folders_name_idx ON public.folders (name);
CREATE INDEX IF NOT EXISTS folders_owner_id_idx ON public.folders (owner_id);
CREATE INDEX IF NOT EXISTS folders_parent_id_idx ON public.folders (parent_id);
CREATE INDEX IF NOT EXISTS folders_owner_name_idx ON public.folders (owner_id, name);
