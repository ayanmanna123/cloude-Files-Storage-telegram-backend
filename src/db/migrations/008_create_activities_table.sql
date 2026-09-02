-- Migration: 008_create_activities_table
-- Description: Creates the activities table for logging user actions and audit history

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

-- Performance indexes
CREATE INDEX IF NOT EXISTS activities_actor_id_idx ON public.activities (actor_id);
CREATE INDEX IF NOT EXISTS activities_created_at_idx ON public.activities (created_at);
CREATE INDEX IF NOT EXISTS activities_created_at_desc_idx ON public.activities (created_at DESC);
