-- Migration: 005_create_shares_table
-- Description: Creates custom share ENUM types and the shares table for access control

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

-- Performance indexes
CREATE INDEX IF NOT EXISTS shares_grantee_user_id_idx ON public.shares (grantee_user_id);
CREATE INDEX IF NOT EXISTS shares_resource_id_idx ON public.shares (resource_id);
CREATE INDEX IF NOT EXISTS shares_created_by_idx ON public.shares (created_by);
CREATE INDEX IF NOT EXISTS shares_resource_idx ON public.shares (resource_type, resource_id);
