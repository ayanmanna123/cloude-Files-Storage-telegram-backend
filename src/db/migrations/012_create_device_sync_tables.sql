-- Migration: 012_create_device_sync_tables
-- Description: Adds device sync support to files table and creates device_sync_logs table

-- 1. Add device sync metadata columns to files table
ALTER TABLE public.files 
ADD COLUMN IF NOT EXISTS source_device VARCHAR(32) DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS is_device_sync BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS files_source_device_idx ON public.files (source_device);
CREATE INDEX IF NOT EXISTS files_is_device_sync_idx ON public.files (is_device_sync);

-- 2. CREATE DEVICE SYNC LOGS TABLE
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
