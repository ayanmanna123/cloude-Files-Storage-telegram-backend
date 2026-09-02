const supabase = require('../config/supabase');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');
const { getPersonalHiddenIds } = require('../utils/hiddenItems');
const getFolderMetrics = (folderId, allFolders, allFiles) => {
  const directSubfolders = allFolders.filter(f => f.parent_id === folderId && !f.is_deleted && !f.is_hidden);
  
  const getAllDescendantFolderIds = (id) => {
    let ids = [];
    const children = allFolders.filter(f => f.parent_id === id && !f.is_deleted && !f.is_hidden);
    for (const child of children) {
      ids.push(child.id);
      ids = ids.concat(getAllDescendantFolderIds(child.id));
    }
    return ids;
  };
  
  const allDescendantFolderIds = [folderId, ...getAllDescendantFolderIds(folderId)];
  const allNestedFiles = allFiles.filter(f => allDescendantFolderIds.includes(f.folder_id));
  
  const fileCount = allNestedFiles.length;
  const totalSize = allNestedFiles.reduce((sum, f) => sum + (f.size_bytes || 0), 0);
  const folderCount = directSubfolders.length;

  return { fileCount, folderCount, totalSize };
};

const getFolderShareRole = async (folderId, userId) => {
  if (!folderId || !userId) return null;

  try {
    const { data, error } = await supabase.rpc('get_folder_share_role', {
      target_folder_id: folderId,
      target_user_id: userId
    });
    if (!error && data !== undefined) {
      return data;
    }
  } catch (rpcErr) {
    // Fallback to sequential traversal if RPC is not present in database
  }

  let currentId = folderId;
  let depth = 0;
  
  while (currentId && depth < 20) {
    const { data: folder } = await supabase
      .from('folders')
      .select('owner_id, parent_id')
      .eq('id', currentId)
      .single();
      
    if (!folder) return null;
    if (folder.owner_id === userId) return 'owner';
    
    // Check if directly shared
    const { data: share } = await supabase
      .from('shares')
      .select('role')
      .eq('resource_type', 'folder')
      .eq('resource_id', currentId)
      .eq('grantee_user_id', userId)
      .single();
      
    if (share) return share.role; // 'editor' or 'viewer'
    
    currentId = folder.parent_id;
    depth++;
  }
  
  return null;
};

const checkFolderAccess = async (folderId, userId) => {
  const role = await getFolderShareRole(folderId, userId);
  return role !== null;
};

const checkFolderEditor = async (folderId, userId) => {
  const role = await getFolderShareRole(folderId, userId);
  return role === 'owner' || role === 'editor';
};

exports.createFolder = async (req, res, next) => {
  try {
    const { name, parentId } = req.body;
    
    if (!name) {
      throw new AppError('Folder name is required', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    let folderOwnerId = req.user.id;
    if (parentId) {
      const parentRole = await getFolderShareRole(parentId, req.user.id);
      if (parentRole !== 'owner' && parentRole !== 'editor') {
        throw new AppError('Unauthorized to edit this folder', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
      
      const { data: parentFolder } = await supabase
        .from('folders')
        .select('owner_id')
        .eq('id', parentId)
        .single();
      if (parentFolder) {
        folderOwnerId = parentFolder.owner_id;
      }
    }

    const { data, error } = await supabase
      .from('folders')
      .insert([
        {
          name,
          parent_id: parentId || null,
          owner_id: folderOwnerId,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(201).json(keysToCamel(data));
  } catch (error) {
    next(error);
  }
};

exports.getRoot = async (req, res, next) => {
  try {
    const { hiddenFolderIds, hiddenFileIds } = await getPersonalHiddenIds(req.user.id);

    // Get all folders to compute subfolder count in memory
    const { data: allUserFolders } = await supabase
      .from('folders')
      .select('id, parent_id, is_deleted, is_hidden')
      .eq('owner_id', req.user.id);

    // Fetch all active files for the user to compute recursive metrics
    const { data: allUserFiles } = await supabase
      .from('files')
      .select('id, folder_id, size_bytes')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);

    // Filter hidden out of metrics memory
    const activeFoldersForMetrics = (allUserFolders || []).filter(f => !hiddenFolderIds.includes(f.id));
    const activeFilesForMetrics = (allUserFiles || []).filter(f => !hiddenFileIds.includes(f.id));

    // Get top-level folders (parent_id is null)
    let foldersQuery = supabase
      .from('folders')
      .select('*')
      .is('parent_id', null)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);

    if (hiddenFolderIds.length > 0) {
      foldersQuery = foldersQuery.not('id', 'in', `(${hiddenFolderIds.join(',')})`);
    }
    const { data: foldersData } = await foldersQuery;

    const folders = foldersData?.map(f => {
      const metrics = getFolderMetrics(f.id, activeFoldersForMetrics, activeFilesForMetrics);
      return {
        ...f,
        fileCount: metrics.fileCount,
        folderCount: metrics.folderCount,
        totalSize: metrics.totalSize
      };
    }) || [];

    // Get top-level files (folder_id is null)
    let filesQuery = supabase
      .from('files')
      .select('*')
      .is('folder_id', null)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);

    if (hiddenFileIds.length > 0) {
      filesQuery = filesQuery.not('id', 'in', `(${hiddenFileIds.join(',')})`);
    }
    const { data: files } = await filesQuery;

    res.status(200).json({
      folder: { name: 'My Drive', id: null },
      children: {
        folders: keysToCamel(folders || []),
        files: keysToCamel(files || []),
      },
      path: []
    });
  } catch (error) {
    next(error);
  }
};

exports.getAllFolders = async (req, res, next) => {
  try {
    const { hiddenFolderIds } = await getPersonalHiddenIds(req.user.id);

    let query = supabase
      .from('folders')
      .select('id, name, parent_id, files(id, size_bytes, is_deleted)')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false)
      .order('name');

    if (hiddenFolderIds.length > 0) {
      query = query.not('id', 'in', `(${hiddenFolderIds.join(',')})`);
    }
    const { data: foldersData, error } = await query;
      
    const folders = foldersData?.map(f => {
      const activeFiles = f.files ? f.files.filter(file => !file.is_deleted) : [];
      return {
        ...f,
        fileCount: activeFiles.length,
        totalSize: activeFiles.reduce((acc, file) => acc + (file.size_bytes || 0), 0)
      };
    }) || [];

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json(keysToCamel(folders || []));
  } catch (error) {
    next(error);
  }
};

exports.getFolder = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify user has access to this folder (owner, or shared)
    const hasAccess = await checkFolderAccess(id, req.user.id);
    if (!hasAccess) {
      throw new AppError('Folder not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    const { hiddenFolderIds, hiddenFileIds } = await getPersonalHiddenIds(req.user.id);

    // 1. Get the folder itself
    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .single();

    if (folderError || !folder) {
      throw new AppError('Folder not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    const ownerId = folder.owner_id;

    // Get all folders of owner or requester to compute subfolder count in memory
    const { data: allUserFolders } = await supabase
      .from('folders')
      .select('id, parent_id, is_deleted, is_hidden')
      .or(`owner_id.eq.${ownerId},owner_id.eq.${req.user.id}`);

    // Fetch all active files for the owner or requester to compute recursive metrics
    const { data: allUserFiles } = await supabase
      .from('files')
      .select('id, folder_id, size_bytes')
      .or(`owner_id.eq.${ownerId},owner_id.eq.${req.user.id}`)
      .eq('is_deleted', false);

    // Filter hidden out of metrics memory
    const activeFoldersForMetrics = (allUserFolders || []).filter(f => !hiddenFolderIds.includes(f.id));
    const activeFilesForMetrics = (allUserFiles || []).filter(f => !hiddenFileIds.includes(f.id));

    // 2. Get children (subfolders)
    let subfoldersQuery = supabase
      .from('folders')
      .select('*')
      .eq('parent_id', id)
      .eq('is_deleted', false);

    if (hiddenFolderIds.length > 0) {
      subfoldersQuery = subfoldersQuery.not('id', 'in', `(${hiddenFolderIds.join(',')})`);
    }
    const { data: subfoldersData } = await subfoldersQuery;

    const folders = subfoldersData?.map(f => {
      const metrics = getFolderMetrics(f.id, activeFoldersForMetrics, activeFilesForMetrics);
      return {
        ...f,
        fileCount: metrics.fileCount,
        folderCount: metrics.folderCount,
        totalSize: metrics.totalSize
      };
    }) || [];

    // 3. Get children (files)
    let filesQuery = supabase
      .from('files')
      .select('*')
      .eq('folder_id', id)
      .eq('is_deleted', false);

    if (hiddenFileIds.length > 0) {
      filesQuery = filesQuery.not('id', 'in', `(${hiddenFileIds.join(',')})`);
    }
    const { data: files } = await filesQuery;

    // 4. Build path recursively (or iteratively)
    let path = [];
    let currentParentId = folder.parent_id;
    
    // Safety limit to prevent infinite loops in corrupted data
    let depth = 0;
    while (currentParentId && depth < 20) {
      const { data: parentFolder } = await supabase
        .from('folders')
        .select('id, name, parent_id')
        .eq('id', currentParentId)
        .single();
        
      if (parentFolder) {
        path.unshift({ id: parentFolder.id, name: parentFolder.name });
        currentParentId = parentFolder.parent_id;
      } else {
        break;
      }
      depth++;
    }
    
    // Add the current folder as the last item in the path
    path.push({ id: folder.id, name: folder.name });

    const permission = folder.owner_id === req.user.id ? 'owner' : await getFolderShareRole(id, req.user.id);
    folder.permission = permission;

    res.status(200).json({
      folder: keysToCamel(folder),
      children: {
        folders: keysToCamel(folders || []),
        files: keysToCamel(files || []),
      },
      path: keysToCamel(path)
    });
  } catch (error) {
    next(error);
  }
};

exports.updateFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, parentId, isHidden } = req.body;

    const hasAccess = await checkFolderAccess(id, req.user.id);
    if (!hasAccess) {
      throw new AppError('Folder not found or unauthorized', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    if (name || parentId !== undefined) {
      const isEditor = await checkFolderEditor(id, req.user.id);
      if (!isEditor) {
        throw new AppError('Folder not found or unauthorized', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
    }

    if (parentId) {
      const { data: sourceFolder } = await supabase.from('folders').select('owner_id').eq('id', id).single();
      if (!sourceFolder || sourceFolder.owner_id !== req.user.id) {
        throw new AppError('Only the folder owner can move folders', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
      const parentRole = await getFolderShareRole(parentId, req.user.id);
      if (parentRole !== 'owner' && parentRole !== 'editor') {
        throw new AppError('Unauthorized to edit target folder', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
    }

    if (isHidden !== undefined) {
      if (isHidden) {
        const { error: upsertErr } = await supabase
          .from('user_hidden_items')
          .upsert([{ user_id: req.user.id, resource_type: 'folder', resource_id: id }]);
        if (upsertErr) {
          console.error("user_hidden_items upsert failed, updating legacy is_hidden column:", upsertErr.message);
          await supabase.from('folders').update({ is_hidden: true }).eq('id', id);
        }
      } else {
        await supabase
          .from('user_hidden_items')
          .delete()
          .eq('user_id', req.user.id)
          .eq('resource_type', 'folder')
          .eq('resource_id', id);
        await supabase.from('folders').update({ is_hidden: false }).eq('id', id);
      }
    }

    let data = null;
    if (name || parentId !== undefined) {
      const updates = {};
      if (name) updates.name = name;
      if (parentId !== undefined) updates.parent_id = parentId;
      updates.updated_at = new Date().toISOString();

      const { data: updatedData, error } = await supabase
        .from('folders')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error || !updatedData) {
        throw new AppError('Folder update failed', ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }
      data = updatedData;
    } else {
      const { data: existingData } = await supabase
        .from('folders')
        .select('*')
        .eq('id', id)
        .single();
      data = existingData;
    }

    const { hiddenFolderIds } = await getPersonalHiddenIds(req.user.id);
    const result = {
      ...data,
      isHidden: isHidden !== undefined ? isHidden : hiddenFolderIds.includes(data?.id)
    };

    res.status(200).json(keysToCamel(result));
  } catch (error) {
    next(error);
  }
};

exports.getHiddenItems = async (req, res, next) => {
  try {
    const { hiddenFolderIds, hiddenFileIds } = await getPersonalHiddenIds(req.user.id);

    // Also include items where legacy is_hidden is true for the current user
    const { data: legacyHiddenFolders } = await supabase
      .from('folders')
      .select('id')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false)
      .eq('is_hidden', true);

    const { data: legacyHiddenFiles } = await supabase
      .from('files')
      .select('id')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false)
      .eq('is_hidden', true);

    const combinedFolderIds = [...new Set([...hiddenFolderIds, ...(legacyHiddenFolders || []).map(f => f.id)])];
    const combinedFileIds = [...new Set([...hiddenFileIds, ...(legacyHiddenFiles || []).map(f => f.id)])];

    // Get all folders to compute subfolder count in memory
    const { data: allUserFolders } = await supabase
      .from('folders')
      .select('id, parent_id, is_deleted, is_hidden')
      .eq('owner_id', req.user.id);

    // Fetch all active files to calculate correct metrics
    const { data: allUserFiles } = await supabase
      .from('files')
      .select('id, folder_id, size_bytes')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);

    // Filter metrics using personal hidden lists
    const activeFoldersForMetrics = (allUserFolders || []).filter(f => !combinedFolderIds.includes(f.id));
    const activeFilesForMetrics = (allUserFiles || []).filter(f => !combinedFileIds.includes(f.id));

    // Get personal hidden folders
    let folders = [];
    if (combinedFolderIds.length > 0) {
      const { data: foldersData, error: folderError } = await supabase
        .from('folders')
        .select('*')
        .in('id', combinedFolderIds)
        .eq('is_deleted', false);

      if (folderError) {
        throw new AppError(folderError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }

      folders = foldersData?.map(f => {
        const metrics = getFolderMetrics(f.id, activeFoldersForMetrics, activeFilesForMetrics);
        return {
          ...f,
          fileCount: metrics.fileCount,
          folderCount: metrics.folderCount,
          totalSize: metrics.totalSize,
          isHidden: true
        };
      }) || [];
    }

    // Get personal hidden files
    let files = [];
    if (combinedFileIds.length > 0) {
      const { data: filesData, error: fileError } = await supabase
        .from('files')
        .select('*')
        .in('id', combinedFileIds)
        .eq('is_deleted', false);

      if (fileError) {
        throw new AppError(fileError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }

      files = filesData?.map(f => ({
        ...f,
        isHidden: true
      })) || [];
    }

    res.status(200).json({
      folders: keysToCamel(folders),
      files: keysToCamel(files)
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteFolder = async (req, res, next) => {
  try {
    const { id } = req.params;

    const isEditor = await checkFolderEditor(id, req.user.id);
    if (!isEditor) {
      throw new AppError('Folder not found or unauthorized', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    // Soft delete
    const { data, error } = await supabase
      .from('folders')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('Folder not found or delete failed', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    res.status(200).json({ status: 'success', message: 'Folder deleted' });
  } catch (error) {
    next(error);
  }
};

exports.copyFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { parentId } = req.body; // target parent folder id

    // 1. Fetch the source folder
    const { data: sourceFolder, error: folderError } = await supabase
      .from('folders')
      .select('*')
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false)
      .single();

    if (folderError || !sourceFolder) {
      throw new AppError('Folder not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // 2. Check for name collisions at the target destination
    let query = supabase
      .from('folders')
      .select('name')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);
      
    if (parentId) {
      query = query.eq('parent_id', parentId);
    } else {
      query = query.is('parent_id', null);
    }

    const { data: existingFolders } = await query;
    const existingNames = new Set((existingFolders || []).map(f => f.name));

    let newName = sourceFolder.name;
    let counter = 1;
    while (existingNames.has(newName)) {
      newName = `${sourceFolder.name} (Copy ${counter})`;
      counter++;
    }

    // Recursive helper
    const copyContents = async (srcFolderId, targetParentId) => {
      // Fetch subfolders
      const { data: subfolders } = await supabase
        .from('folders')
        .select('*')
        .eq('parent_id', srcFolderId)
        .eq('is_deleted', false);
        
      if (subfolders && subfolders.length > 0) {
        for (const sub of subfolders) {
          const { data: newSub } = await supabase
            .from('folders')
            .insert([{
              name: sub.name,
              parent_id: targetParentId,
              owner_id: req.user.id
            }])
            .select()
            .single();
            
          if (newSub) {
            await copyContents(sub.id, newSub.id);
          }
        }
      }

      // Fetch files
      const { data: files } = await supabase
        .from('files')
        .select('*')
        .eq('folder_id', srcFolderId)
        .eq('is_deleted', false);
        
      if (files && files.length > 0) {
        for (const file of files) {
          const { data: newFile } = await supabase
            .from('files')
            .insert([{
              name: file.name,
              mime_type: file.mime_type,
              size_bytes: file.size_bytes,
              storage_key: file.storage_key,
              owner_id: req.user.id,
              folder_id: targetParentId
            }])
            .select()
            .single();

          if (newFile) {
            const { data: version } = await supabase
              .from('file_versions')
              .insert([{
                file_id: newFile.id,
                version_number: 1,
                storage_key: file.storage_key,
                size_bytes: file.size_bytes,
              }])
              .select('id')
              .single();

            if (version) {
              await supabase
                .from('files')
                .update({ version_id: version.id })
                .eq('id', newFile.id);
            }
          }
        }
      }
    };

    // 3. Create the top-level copied folder
    const { data: newFolder, error: insertError } = await supabase
      .from('folders')
      .insert([{
        name: newName,
        parent_id: parentId || null,
        owner_id: req.user.id
      }])
      .select()
      .single();

    if (insertError) {
      throw new AppError(insertError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    // 4. Start recursion
    await copyContents(id, newFolder.id);

    res.status(200).json(keysToCamel(newFolder));
  } catch (error) {
    next(error);
  }
};
