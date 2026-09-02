-- Migration: 006_create_link_shares_table
-- Description: Creates link_shares and bundle_shares tables for public shareable links

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
