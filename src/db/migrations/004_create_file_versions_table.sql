-- Migration: 004_create_file_versions_table
-- Description: Creates the file_versions table for asset history and attaches foreign key to files table

CREATE TABLE IF NOT EXISTS public.file_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    storage_key TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance index
CREATE INDEX IF NOT EXISTS file_versions_file_id_idx ON public.file_versions (file_id);

-- Attach strict foreign key reference to files table
ALTER TABLE public.files 
DROP CONSTRAINT IF EXISTS fk_files_version_id,
ADD CONSTRAINT fk_files_version_id 
FOREIGN KEY (version_id) 
REFERENCES public.file_versions(id) 
ON DELETE SET NULL;
