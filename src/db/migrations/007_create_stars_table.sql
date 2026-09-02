-- Migration: 007_create_stars_table
-- Description: Creates the stars table for favoriting files and folders

CREATE TABLE IF NOT EXISTS public.stars (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    resource_type share_resource_type NOT NULL,
    resource_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS stars_user_id_idx ON public.stars (user_id);
