-- PostgreSQL Recursive CTE function for resolving folder permissions in 1 single database query.
-- Run this in your Supabase SQL Editor for maximum performance.

CREATE OR REPLACE FUNCTION get_folder_share_role(target_folder_id UUID, target_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    result_role TEXT;
BEGIN
    WITH RECURSIVE folder_ancestry AS (
        -- Anchor: target folder
        SELECT id, owner_id, parent_id, 0 AS depth
        FROM folders
        WHERE id = target_folder_id
        
        UNION ALL
        
        -- Recursive step: parent folders up to depth 20
        SELECT f.id, f.owner_id, f.parent_id, fa.depth + 1
        FROM folders f
        INNER JOIN folder_ancestry fa ON f.id = fa.parent_id
        WHERE fa.depth < 20
    )
    SELECT 
        CASE 
            WHEN fa.owner_id = target_user_id THEN 'owner'
            WHEN s.role IS NOT NULL THEN s.role
            ELSE NULL
        END INTO result_role
    FROM folder_ancestry fa
    LEFT JOIN shares s ON s.resource_type = 'folder' 
                      AND s.resource_id = fa.id 
                      AND s.grantee_user_id = target_user_id
    WHERE fa.owner_id = target_user_id OR s.role IS NOT NULL
    ORDER BY fa.depth ASC
    LIMIT 1;

    RETURN result_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
