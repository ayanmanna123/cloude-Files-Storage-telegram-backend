const supabase = require('../config/supabase');
const imagekit = require('../config/imagekit');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');
const { getPersonalHiddenIds } = require('../utils/hiddenItems');

exports.search = async (req, res, next) => {
  try {
    const { q, type, starred } = req.query;
    const { hiddenFolderIds, hiddenFileIds } = await getPersonalHiddenIds(req.user.id);

    let results = [];

    if (!type || type === 'file') {
      let query = supabase.from('files').select('*').eq('owner_id', req.user.id).eq('is_deleted', false);
      if (hiddenFileIds.length > 0) {
        query = query.not('id', 'in', `(${hiddenFileIds.join(',')})`);
      }
      if (q) query = query.ilike('name', `%${q}%`);
      const { data: files } = await query;
      if (files) results = results.concat(files.map(f => ({ ...f, type: 'file' })));
    }

    if (!type || type === 'folder') {
      let query = supabase.from('folders').select('*').eq('owner_id', req.user.id).eq('is_deleted', false);
      if (hiddenFolderIds.length > 0) {
        query = query.not('id', 'in', `(${hiddenFolderIds.join(',')})`);
      }
      if (q) query = query.ilike('name', `%${q}%`);
      const { data: folders } = await query;
      if (folders) results = results.concat(folders.map(f => ({ ...f, type: 'folder' })));
    }

    // Filter by starred if requested
    if (starred === 'true') {
      const { data: stars } = await supabase.from('stars').select('*').eq('user_id', req.user.id);
      const starredItems = stars.map(s => `${s.resource_type}_${s.resource_id}`);
      results = results.filter(r => starredItems.includes(`${r.type}_${r.id}`));
    }

    res.status(200).json(keysToCamel(results));
  } catch (error) {
    next(error);
  }
};

exports.addStar = async (req, res, next) => {
  try {
    const { resourceType, resourceId } = req.body;

    if (!resourceType || !resourceId) {
      throw new AppError('Missing resource type or id', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const { data, error } = await supabase
      .from('stars')
      .insert([
        {
          user_id: req.user.id,
          resource_type: resourceType,
          resource_id: resourceId,
        },
      ])
      .select()
      .single();

    // Ignore unique constraint error if already starred
    if (error && error.code !== '23505') {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({ status: 'success', message: 'Resource starred' });
  } catch (error) {
    next(error);
  }
};

exports.removeStar = async (req, res, next) => {
  try {
    const { resourceType, resourceId } = req.body;

    await supabase
      .from('stars')
      .delete()
      .eq('user_id', req.user.id)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId);

    res.status(200).json({ status: 'success', message: 'Star removed' });
  } catch (error) {
    next(error);
  }
};

exports.getTrash = async (req, res, next) => {
  try {
    const { data: files } = await supabase.from('files').select('*').eq('owner_id', req.user.id).eq('is_deleted', true);
    const { data: folders } = await supabase.from('folders').select('*').eq('owner_id', req.user.id).eq('is_deleted', true);

    const trashed = [
      ...(files || []).map(f => ({ ...f, type: 'file' })),
      ...(folders || []).map(f => ({ ...f, type: 'folder' }))
    ];

    res.status(200).json(keysToCamel(trashed));
  } catch (error) {
    next(error);
  }
};

exports.restoreTrash = async (req, res, next) => {
  try {
    const { resourceType, resourceId } = req.body;

    if (!resourceType || !resourceId) {
      throw new AppError('Missing resource type or id', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const table = resourceType === 'file' ? 'files' : 'folders';

    const { error } = await supabase
      .from(table)
      .update({ is_deleted: false, updated_at: new Date().toISOString() })
      .eq('id', resourceId)
      .eq('owner_id', req.user.id);

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({ status: 'success', message: 'Resource restored' });
  } catch (error) {
    next(error);
  }
};

const getAllFilesForFolder = async (folderId, ownerId) => {
  let filesToDelete = [];
  let currentFolderIds = [folderId];
  
  while (currentFolderIds.length > 0) {
    const { data: files } = await supabase
      .from('files')
      .select('id, storage_key')
      .in('folder_id', currentFolderIds)
      .eq('owner_id', ownerId);
      
    if (files && files.length > 0) {
      filesToDelete = filesToDelete.concat(files);
    }
    
    const { data: subfolders } = await supabase
      .from('folders')
      .select('id')
      .in('parent_id', currentFolderIds)
      .eq('owner_id', ownerId);
      
    if (subfolders && subfolders.length > 0) {
      currentFolderIds = subfolders.map(f => f.id);
    } else {
      break;
    }
  }
  
  return filesToDelete;
};

const deleteFromImageKit = async (storageKey) => {
  if (!storageKey) return;
  
  try {
    const fileName = storageKey.split('/').pop();
    const result = await new Promise((resolve) => {
      imagekit.listFiles({ searchQuery: `name="${fileName}"` }, (err, res) => {
        if (err) resolve(null);
        else resolve(res);
      });
    });
    
    if (result && result.length > 0) {
      // Find exact match just in case
      const targetFile = result.find(f => f.filePath === `/${storageKey}`) || result[0];
      await new Promise((resolve) => {
        imagekit.deleteFile(targetFile.fileId, (err, res) => {
          if (err) console.error("ImageKit delete error:", err);
          resolve(res);
        });
      });
    }
  } catch (error) {
    console.error("Error deleting from ImageKit:", error);
  }
};

exports.hardDeleteTrash = async (req, res, next) => {
  try {
    const { type, id } = req.params;
    
    if (type !== 'file' && type !== 'folder') {
      throw new AppError('Invalid resource type', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    let filesToDelete = [];
    // Gather files to delete from ImageKit
    if (type === 'file') {
      const { data: file } = await supabase
        .from('files')
        .select('id, storage_key')
        .eq('id', id)
        .eq('owner_id', req.user.id)
        .single();
        
      if (file) filesToDelete.push(file);
    } else if (type === 'folder') {
      filesToDelete = await getAllFilesForFolder(id, req.user.id);
    }
    
    // Get all storage keys including older versions
    const fileIds = filesToDelete.map(f => f.id);
    let allStorageKeys = filesToDelete.map(f => f.storage_key).filter(k => k);
    
    if (fileIds.length > 0) {
      const { data: versions } = await supabase
        .from('file_versions')
        .select('storage_key')
        .in('file_id', fileIds);
        
      if (versions) {
        versions.forEach(v => {
          if (v.storage_key && !allStorageKeys.includes(v.storage_key)) {
            allStorageKeys.push(v.storage_key);
          }
        });
      }
    }
    
    // Delete from ImageKit
    for (const storageKey of allStorageKeys) {
      await deleteFromImageKit(storageKey);
    }
    
    const table = type === 'file' ? 'files' : 'folders';

    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', true);

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({ status: 'success', message: 'Resource permanently deleted' });
  } catch (error) {
    next(error);
  }
};
