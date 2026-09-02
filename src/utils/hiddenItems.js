const supabase = require('../config/supabase');

const getPersonalHiddenIds = async (userId) => {
  if (!userId) {
    return { hiddenFolderIds: [], hiddenFileIds: [] };
  }
  
  let hiddenFolderIds = [];
  let hiddenFileIds = [];

  // 1. Try fetching from user_hidden_items table
  try {
    const { data, error } = await supabase
      .from('user_hidden_items')
      .select('resource_type, resource_id')
      .eq('user_id', userId);
      
    if (!error && data) {
      hiddenFolderIds = data.filter(r => r.resource_type === 'folder').map(r => r.resource_id);
      hiddenFileIds = data.filter(r => r.resource_type === 'file').map(r => r.resource_id);
    }
  } catch (err) {
    console.error("Error querying user_hidden_items:", err);
  }

  // 2. Also fetch legacy is_hidden items owned by this user
  try {
    const [legacyFolders, legacyFiles] = await Promise.all([
      supabase.from('folders').select('id').eq('owner_id', userId).eq('is_deleted', false).eq('is_hidden', true),
      supabase.from('files').select('id').eq('owner_id', userId).eq('is_deleted', false).eq('is_hidden', true)
    ]);

    if (legacyFolders?.data) {
      const legacyFolderIds = legacyFolders.data.map(f => f.id);
      hiddenFolderIds = [...new Set([...hiddenFolderIds, ...legacyFolderIds])];
    }

    if (legacyFiles?.data) {
      const legacyFileIds = legacyFiles.data.map(f => f.id);
      hiddenFileIds = [...new Set([...hiddenFileIds, ...legacyFileIds])];
    }
  } catch (err) {
    console.error("Error querying legacy is_hidden items:", err);
  }
    
  return { hiddenFolderIds, hiddenFileIds };
};

module.exports = {
  getPersonalHiddenIds
};
