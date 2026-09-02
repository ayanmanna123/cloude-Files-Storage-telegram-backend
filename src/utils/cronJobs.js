const cron = require('node-cron');
const supabase = require('../config/supabase');

const initCronJobs = () => {
  // Run every day at midnight (0 0 * * *)
  cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Starting automatic trash cleanup...');
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoffDate = thirtyDaysAgo.toISOString();

      // Delete files
      const { data: filesDeleted, error: fileError } = await supabase
        .from('files')
        .delete()
        .eq('is_deleted', true)
        .lt('updated_at', cutoffDate)
        .select('id');

      if (fileError) {
        console.error('[CRON] Error deleting files:', fileError);
      } else if (filesDeleted && filesDeleted.length > 0) {
        console.log(`[CRON] Cleaned up ${filesDeleted.length} expired files from trash.`);
      }

      // Delete folders
      const { data: foldersDeleted, error: folderError } = await supabase
        .from('folders')
        .delete()
        .eq('is_deleted', true)
        .lt('updated_at', cutoffDate)
        .select('id');

      if (folderError) {
        console.error('[CRON] Error deleting folders:', folderError);
      } else if (foldersDeleted && foldersDeleted.length > 0) {
        console.log(`[CRON] Cleaned up ${foldersDeleted.length} expired folders from trash.`);
      }

      console.log('[CRON] Trash cleanup completed.');
    } catch (err) {
      console.error('[CRON] Unexpected error during trash cleanup:', err);
    }
  });

  console.log('Cron jobs initialized.');
};

module.exports = { initCronJobs };
