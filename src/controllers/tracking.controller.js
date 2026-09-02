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
exports.trackOpen = async (req, res, next) => {
  try {
    const { id, type } = req.body; // type is 'file' or 'folder'
    
    if (!id || !['file', 'folder'].includes(type)) {
      return res.status(400).json({ status: 'error', message: 'Invalid id or type' });
    }

    const table = type === 'file' ? 'files' : 'folders';

    const { error } = await supabase
      .from(table)
      .update({ last_opened_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      // If column doesn't exist yet, we just ignore the error gracefully
      console.error(`Failed to track open for ${type} ${id}:`, error.message);
    }

    res.status(200).json({ status: 'success' });
  } catch (error) {
    next(error);
  }
};

exports.getRecentItems = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Helper to safely execute query
    const safeQuery = (query) => query.then(res => res).catch(() => ({ data: [] }));

    // Get shared resources
    const { data: shares } = await supabase
      .from('shares')
      .select('resource_type, resource_id')
      .eq('grantee_user_id', userId);

    const sharedFileIds = (shares || []).filter(s => s.resource_type === 'file').map(s => s.resource_id);
    const sharedFolderIds = (shares || []).filter(s => s.resource_type === 'folder').map(s => s.resource_id);

    const filesOr = sharedFileIds.length > 0 ? `owner_id.eq.${userId},id.in.(${sharedFileIds.join(',')})` : `owner_id.eq.${userId}`;
    const foldersOr = sharedFolderIds.length > 0 ? `owner_id.eq.${userId},id.in.(${sharedFolderIds.join(',')})` : `owner_id.eq.${userId}`;

    // Fetch top 50 files by open date and top 50 files by update date
    const [filesOpen, filesUpdate, foldersOpen, foldersUpdate, allUserFoldersData, allUserFilesData] = await Promise.all([
      safeQuery(supabase.from('files').select('*').or(filesOr).eq('is_deleted', false).eq('is_hidden', false).order('last_opened_at', { ascending: false, nullsFirst: false }).limit(50)),
      safeQuery(supabase.from('files').select('*').or(filesOr).eq('is_deleted', false).eq('is_hidden', false).order('updated_at', { ascending: false }).limit(50)),
      safeQuery(supabase.from('folders').select('*').or(foldersOr).eq('is_deleted', false).eq('is_hidden', false).order('last_opened_at', { ascending: false, nullsFirst: false }).limit(50)),
      safeQuery(supabase.from('folders').select('*').or(foldersOr).eq('is_deleted', false).eq('is_hidden', false).order('updated_at', { ascending: false }).limit(50)),
      safeQuery(supabase.from('folders').select('id, parent_id, is_deleted, is_hidden').eq('owner_id', req.user.id)),
      safeQuery(supabase.from('files').select('id, folder_id, size_bytes').eq('owner_id', userId).eq('is_deleted', false).eq('is_hidden', false))
    ]);

    // Helper to extract data
    const getSafeData = (result) => (result && result.data) ? result.data : [];

    const allFiles = [...getSafeData(filesOpen), ...getSafeData(filesUpdate)];
    const allFolders = [...getSafeData(foldersOpen), ...getSafeData(foldersUpdate)];
    const allUserFolders = getSafeData(allUserFoldersData);
    const allUserFiles = getSafeData(allUserFilesData);

    // Deduplicate
    const uniqueFilesMap = new Map();
    allFiles.forEach(f => uniqueFilesMap.set(f.id, f));
    
    const uniqueFoldersMap = new Map();
    allFolders.forEach(f => {
      const metrics = getFolderMetrics(f.id, allUserFolders || [], allUserFiles || []);
      f.fileCount = metrics.fileCount;
      f.folderCount = metrics.folderCount;
      f.totalSize = metrics.totalSize;
      uniqueFoldersMap.set(f.id, f);
    });

    const { hiddenFolderIds, hiddenFileIds } = await getPersonalHiddenIds(userId);

    const uniqueFiles = Array.from(uniqueFilesMap.values())
      .filter(f => !hiddenFileIds.includes(f.id))
      .map(f => ({ ...f, item_type: 'file' }));
      
    const uniqueFolders = Array.from(uniqueFoldersMap.values())
      .filter(f => !hiddenFolderIds.includes(f.id))
      .map(f => ({ ...f, item_type: 'folder' }));

    // Combine and sort
    const combined = [...uniqueFiles, ...uniqueFolders];
    combined.sort((a, b) => {
      const dateA = new Date(a.last_opened_at || a.updated_at || a.created_at).getTime();
      const dateB = new Date(b.last_opened_at || b.updated_at || b.created_at).getTime();
      return dateB - dateA; // Descending
    });

    // Return top 50
    const top50 = combined.slice(0, 50);

    res.status(200).json(keysToCamel(top50));
  } catch (error) {
    next(error);
  }
};
