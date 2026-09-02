const supabase = require('../config/supabase');
const { uploadToTelegram, getTelegramFileStream, deleteFromTelegram } = require('../services/telegram.service');
const { Readable } = require('stream');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');
const { getPersonalHiddenIds } = require('../utils/hiddenItems');
const crypto = require('crypto');
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

const checkFileAccess = async (fileId, userId) => {
  const { data: file } = await supabase
    .from('files')
    .select('owner_id, folder_id')
    .eq('id', fileId)
    .single();

  if (!file) return false;
  if (file.owner_id === userId) return true;

  // Check if directly shared
  const { data: share } = await supabase
    .from('shares')
    .select('id')
    .eq('resource_type', 'file')
    .eq('resource_id', fileId)
    .eq('grantee_user_id', userId)
    .single();

  if (share) return true;

  // Check if parent folder is shared
  if (file.folder_id) {
    return await checkFolderAccess(file.folder_id, userId);
  }

  return false;
};

const checkFileEditor = async (fileId, userId) => {
  const { data: file } = await supabase
    .from('files')
    .select('owner_id, folder_id')
    .eq('id', fileId)
    .single();

  if (!file) return false;
  if (file.owner_id === userId) return true;

  // Check if directly shared with editor role
  const { data: share } = await supabase
    .from('shares')
    .select('role')
    .eq('resource_type', 'file')
    .eq('resource_id', fileId)
    .eq('grantee_user_id', userId)
    .eq('role', 'editor')
    .single();

  if (share) return true;

  // Check if parent folder is shared with editor role
  if (file.folder_id) {
    const folderRole = await getFolderShareRole(file.folder_id, userId);
    return folderRole === 'owner' || folderRole === 'editor';
  }

  return false;
};

exports.initFileUpload = async (req, res, next) => {
  try {
    const { name, mimeType, sizeBytes, folderId, targetFileId, isEncrypted, encryptionIv, sourceDevice, isDeviceSync } = req.body;

    if (!name || !mimeType || !sizeBytes) {
      throw new AppError('Missing required file metadata', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    let fileOwnerId = req.user.id;
    let targetFolderId = folderId || null;

    // If device sync upload and no explicit folder specified, find/create Mobile Uploads or Laptop Uploads folder
    if (!targetFolderId && (isDeviceSync || (sourceDevice && sourceDevice !== 'unknown'))) {
      const deviceType = (sourceDevice || 'laptop').toLowerCase();
      const folderName = deviceType === 'mobile' ? 'Mobile Uploads' : 'Laptop Uploads';

      try {
        const { data: existingFolder } = await supabase
          .from('folders')
          .select('id')
          .eq('owner_id', fileOwnerId)
          .eq('name', folderName)
          .is('parent_id', null)
          .eq('is_deleted', false)
          .maybeSingle();

        if (existingFolder) {
          targetFolderId = existingFolder.id;
        } else {
          const { data: createdFolder } = await supabase
            .from('folders')
            .insert([{
              name: folderName,
              owner_id: fileOwnerId,
              parent_id: null
            }])
            .select('id')
            .single();

          if (createdFolder) {
            targetFolderId = createdFolder.id;
          }
        }
      } catch (folderErr) {
        console.error("Error auto-creating device sync folder:", folderErr);
      }
    }

    if (targetFolderId) {
      const folderRole = await getFolderShareRole(targetFolderId, req.user.id);
      if (folderRole && folderRole !== 'owner' && folderRole !== 'editor') {
        throw new AppError('Unauthorized to edit this folder', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }

      const { data: parentFolder } = await supabase
        .from('folders')
        .select('owner_id')
        .eq('id', targetFolderId)
        .single();
      if (parentFolder) {
        fileOwnerId = parentFolder.owner_id;
      }
    }

    // Generate a unique storage key with strict sanitization (ImageKit replaces special chars with _)
    const uniqueId = crypto.randomUUID();
    const sanitizedName = name.replace(/[^a-zA-Z0-9.\-]/g, '_');

    // Check for existing file
    let existingFile = null;

    if (targetFileId) {
      const { data: fileData, error: fileError } = await supabase
        .from('files')
        .select('id, name, owner_id')
        .eq('id', targetFileId)
        .eq('is_deleted', false)
        .single();

      if (fileError) console.error("Error finding targetFileId:", fileError);

      if (fileData) {
        if (fileData.owner_id === req.user.id) {
          existingFile = fileData;
        } else {
          // Check for editor permission in shares
          const { data: shareData } = await supabase
            .from('shares')
            .select('role')
            .eq('resource_type', 'file')
            .eq('resource_id', targetFileId)
            .eq('grantee_user_id', req.user.id)
            .eq('role', 'editor')
            .single();

          if (shareData) {
            existingFile = fileData;
          } else {
            throw new AppError('Unauthorized to edit this file', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
          }
        }
      }
    } else {
      let query = supabase
        .from('files')
        .select('id, name, owner_id')
        .eq('owner_id', fileOwnerId)
        .eq('name', name)
        .eq('is_deleted', false);

      if (targetFolderId) {
        query = query.eq('folder_id', targetFolderId);
      } else {
        query = query.is('folder_id', null);
      }

      const { data: existingFiles, error: queryError } = await query.limit(1);
      if (queryError) console.error("Error querying existing files:", queryError);
      existingFile = existingFiles && existingFiles.length > 0 ? existingFiles[0] : null;
    }

    // We use the owner's ID for the storage key to keep files grouped by original owner
    const storageOwnerId = existingFile ? existingFile.owner_id : fileOwnerId;
    const storageKey = `user_${storageOwnerId}/${uniqueId}_${sanitizedName}`;

    const existingFileId = existingFile ? existingFile.id : null;
    let fileId;
    let isNewVersion = false;

    if (existingFileId) {
      if (isDeviceSync && !targetFileId) {
        return res.status(200).json({
          fileId: existingFileId,
          isDuplicate: true,
          message: 'File already synced'
        });
      }
      fileId = existingFileId;
      isNewVersion = true;
    } else {
      const insertPayload = {
        name,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        storage_key: storageKey,
        owner_id: fileOwnerId,
        folder_id: targetFolderId || null,
        source_device: sourceDevice || 'unknown',
        is_device_sync: !!isDeviceSync
      };
      if (isEncrypted !== undefined) {
        insertPayload.is_encrypted = isEncrypted;
      }
      if (encryptionIv) {
        insertPayload.encryption_iv = encryptionIv;
      }

      let { data: newFile, error } = await supabase
        .from('files')
        .insert([insertPayload])
        .select()
        .single();

      if (error) {
        if (error.message && (error.message.includes('is_encrypted') || error.message.includes('source_device') || error.message.includes('column') || error.message.includes('schema cache'))) {
          delete insertPayload.is_encrypted;
          delete insertPayload.encryption_iv;
          delete insertPayload.source_device;
          delete insertPayload.is_device_sync;
          const retry = await supabase
            .from('files')
            .insert([insertPayload])
            .select()
            .single();
          newFile = retry.data;
          error = retry.error;
        }
      }

      if (error) {
        throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }
      fileId = newFile.id;
    }

    res.status(200).json({
      fileId: fileId,
      storageKey: storageKey,
      isNewVersion,
      upload: {
        method: 'telegram',
        uploadUrl: '/api/files/upload'
      },
    });
  } catch (error) {
    next(error);
  }
};

const saveFileBufferToTelegramAndDb = async ({
  fileBuffer,
  fileName,
  mimeType,
  rawFolderId,
  targetFileId,
  isEncrypted,
  encryptionIv,
  sourceDevice,
  isDeviceSync,
  userId
}) => {
  let targetFolderId = (rawFolderId && rawFolderId !== 'null' && rawFolderId !== 'undefined') ? rawFolderId : null;
  let fileOwnerId = userId;

  // If device sync upload and no explicit folder specified, find/create Mobile Uploads or Laptop Uploads folder
  if (!targetFolderId && (isDeviceSync || (sourceDevice && sourceDevice !== 'unknown'))) {
    const deviceType = (sourceDevice || 'laptop').toLowerCase();
    const folderName = deviceType === 'mobile' ? 'Mobile Uploads' : 'Laptop Uploads';

    try {
      const { data: existingFolder } = await supabase
        .from('folders')
        .select('id')
        .eq('owner_id', fileOwnerId)
        .eq('name', folderName)
        .is('parent_id', null)
        .eq('is_deleted', false)
        .maybeSingle();

      if (existingFolder) {
        targetFolderId = existingFolder.id;
      } else {
        const { data: createdFolder } = await supabase
          .from('folders')
          .insert([{
            name: folderName,
            owner_id: fileOwnerId,
            parent_id: null
          }])
          .select('id')
          .single();

        if (createdFolder) {
          targetFolderId = createdFolder.id;
        }
      }
    } catch (folderErr) {
      console.error("Error auto-creating device sync folder:", folderErr);
    }
  }

  if (targetFolderId) {
    const folderRole = await getFolderShareRole(targetFolderId, userId);
    if (folderRole && folderRole !== 'owner' && folderRole !== 'editor') {
      throw new AppError('Unauthorized to edit this folder', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }
    const { data: parentFolder } = await supabase
      .from('folders')
      .select('owner_id')
      .eq('id', targetFolderId)
      .single();
    if (parentFolder) {
      fileOwnerId = parentFolder.owner_id;
    }
  }

  let existingFile = null;
  if (targetFileId) {
    const { data: fileData } = await supabase
      .from('files')
      .select('id, name, owner_id, storage_key')
      .eq('id', targetFileId)
      .eq('is_deleted', false)
      .single();

    if (fileData) {
      const isEditor = await checkFileEditor(targetFileId, userId);
      if (isEditor) {
        existingFile = fileData;
      } else {
        throw new AppError('Unauthorized to edit this file', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
    }
  } else {
    let query = supabase
      .from('files')
      .select('id, name, owner_id, storage_key')
      .eq('owner_id', fileOwnerId)
      .eq('name', fileName)
      .eq('is_deleted', false);

    if (targetFolderId) query = query.eq('folder_id', targetFolderId);
    else query = query.is('folder_id', null);

    const { data: existingFiles } = await query.limit(1);
    existingFile = existingFiles && existingFiles.length > 0 ? existingFiles[0] : null;
  }

  const { fileId: telegramFileId, messageId: telegramMessageId, fileSize } = await uploadToTelegram(
    fileBuffer,
    fileName,
    mimeType || 'application/octet-stream'
  );

  const storageKey = `tg:${telegramFileId}:${telegramMessageId}`;
  const existingFileId = existingFile ? existingFile.id : null;
  let fileId;
  let isNewVersion = false;

  if (existingFileId) {
    fileId = existingFileId;
    isNewVersion = true;

    const { data: versions } = await supabase
      .from('file_versions')
      .select('version_number')
      .eq('file_id', existingFileId)
      .order('version_number', { ascending: false });

    const hasVersion1 = (versions || []).some(v => v.version_number === 1);
    if (!hasVersion1) {
      await supabase.from('file_versions').insert([{
        file_id: existingFileId,
        version_number: 1,
        storage_key: existingFile.storage_key,
        size_bytes: fileBuffer.length,
        created_at: new Date().toISOString()
      }]);
    }

    const maxVer = (versions && versions.length > 0) ? Math.max(...versions.map(v => v.version_number)) : 1;
    const nextVersion = maxVer + 1;

    const { data: newVersion } = await supabase
      .from('file_versions')
      .insert([{
        file_id: existingFileId,
        version_number: nextVersion,
        storage_key: storageKey,
        size_bytes: fileSize || fileBuffer.length,
      }])
      .select('id')
      .single();

    const updates = {
      storage_key: storageKey,
      size_bytes: fileSize || fileBuffer.length,
      mime_type: mimeType || 'application/octet-stream',
      updated_at: new Date().toISOString()
    };
    if (newVersion) updates.version_id = newVersion.id;
    if (isEncrypted !== undefined) updates.is_encrypted = isEncrypted;
    if (encryptionIv) updates.encryption_iv = encryptionIv;

    await supabase.from('files').update(updates).eq('id', existingFileId);

  } else {
    const insertPayload = {
      name: fileName,
      mime_type: mimeType || 'application/octet-stream',
      size_bytes: fileSize || fileBuffer.length,
      storage_key: storageKey,
      owner_id: fileOwnerId,
      folder_id: targetFolderId,
      is_encrypted: isEncrypted,
      encryption_iv: encryptionIv || null,
      source_device: sourceDevice || null,
      is_device_sync: isDeviceSync,
    };

    let { data: newFile, error } = await supabase
      .from('files')
      .insert([insertPayload])
      .select()
      .single();

    if (error && (error.message.includes('is_encrypted') || error.message.includes('column'))) {
      delete insertPayload.is_encrypted;
      delete insertPayload.encryption_iv;
      delete insertPayload.source_device;
      delete insertPayload.is_device_sync;
      const retry = await supabase.from('files').insert([insertPayload]).select().single();
      newFile = retry.data;
      error = retry.error;
    }

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    fileId = newFile.id;

    await supabase.from('file_versions').insert([{
      file_id: fileId,
      version_number: 1,
      storage_key: storageKey,
      size_bytes: fileSize || fileBuffer.length,
    }]);
  }

  const { data: updatedFile } = await supabase.from('files').select('*').eq('id', fileId).single();

  return {
    status: 'success',
    fileId,
    storageKey,
    isNewVersion,
    file: keysToCamel(updatedFile)
  };
};

exports.uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const {
      name: bodyName,
      folderId: rawFolderId,
      targetFileId,
      isEncrypted: rawIsEncrypted,
      encryptionIv,
      sourceDevice,
      isDeviceSync: rawIsDeviceSync,
    } = req.body;

    const fileName = bodyName || req.file.originalname;
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const isEncrypted = rawIsEncrypted === 'true' || rawIsEncrypted === true;
    const isDeviceSync = rawIsDeviceSync === 'true' || rawIsDeviceSync === true;

    const result = await saveFileBufferToTelegramAndDb({
      fileBuffer: req.file.buffer,
      fileName,
      mimeType,
      rawFolderId,
      targetFileId,
      isEncrypted,
      encryptionIv,
      sourceDevice,
      isDeviceSync,
      userId: req.user.id
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// In-memory chunk storage session map
const chunkSessions = new Map();

// Periodic cleanup of orphaned upload sessions (>30 min old)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of chunkSessions.entries()) {
    if (now - session.createdAt > 30 * 60 * 1000) {
      chunkSessions.delete(id);
    }
  }
}, 10 * 60 * 1000);

exports.uploadChunk = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No chunk buffer provided', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const {
      uploadId,
      chunkIndex: rawIndex,
      totalChunks: rawTotal,
      name: bodyName,
      folderId: rawFolderId,
      targetFileId,
      isEncrypted: rawIsEncrypted,
      encryptionIv,
      sourceDevice,
      isDeviceSync: rawIsDeviceSync,
      mimeType: rawMimeType
    } = req.body;

    if (!uploadId || rawIndex === undefined || !rawTotal) {
      throw new AppError('Missing chunk metadata', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const chunkIndex = Number(rawIndex);
    const totalChunks = Number(rawTotal);

    let session = chunkSessions.get(uploadId);
    if (!session) {
      session = {
        chunks: new Map(),
        totalChunks,
        createdAt: Date.now()
      };
      chunkSessions.set(uploadId, session);
    }

    session.chunks.set(chunkIndex, req.file.buffer);

    // If not all chunks received yet
    if (session.chunks.size < totalChunks) {
      return res.status(200).json({
        status: 'chunk_received',
        uploadId,
        chunkIndex,
        totalChunks,
        receivedChunks: session.chunks.size
      });
    }

    // All chunks received! Reassemble file buffer in sequential order
    const orderedBuffers = [];
    for (let i = 0; i < totalChunks; i++) {
      const buf = session.chunks.get(i);
      if (!buf) {
        throw new AppError(`Missing chunk index ${i}`, ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
      }
      orderedBuffers.push(buf);
    }

    const completeBuffer = Buffer.concat(orderedBuffers);
    chunkSessions.delete(uploadId);

    const fileName = bodyName || req.file.originalname || 'file';
    const mimeType = rawMimeType || req.file.mimetype || 'application/octet-stream';
    const isEncrypted = rawIsEncrypted === 'true' || rawIsEncrypted === true;
    const isDeviceSync = rawIsDeviceSync === 'true' || rawIsDeviceSync === true;

    const result = await saveFileBufferToTelegramAndDb({
      fileBuffer: completeBuffer,
      fileName,
      mimeType,
      rawFolderId,
      targetFileId,
      isEncrypted,
      encryptionIv,
      sourceDevice,
      isDeviceSync,
      userId: req.user.id
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

exports.streamRawFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const hasAccess = await checkFileAccess(id, req.user.id);
    if (!hasAccess) {
      throw new AppError('File not found or access denied', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    const { data: file, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .single();

    if (error || !file || !file.storage_key) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    const parts = file.storage_key.split(':');
    const telegramFileId = (parts.length >= 2 && parts[0] === 'tg') ? parts[1] : file.storage_key;

    const { response } = await getTelegramFileStream(telegramFileId);

    const isDownload = req.query.download === 'true' || req.query.attachment === 'true';
    const dispositionType = isDownload ? 'attachment' : 'inline';

    const resolveMimeType = (fileName, fileMime) => {
      if (fileMime && fileMime !== 'application/octet-stream') return fileMime;
      const ext = (fileName || '').split('.').pop().toLowerCase();
      const mimeMap = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        avif: 'image/avif',
        heic: 'image/heic',
        heif: 'image/heif',
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
        pdf: 'application/pdf',
        txt: 'text/plain',
        json: 'application/json',
      };
      return mimeMap[ext] || fileMime || 'application/octet-stream';
    };

    const contentType = resolveMimeType(file.name, file.mime_type);
    res.setHeader('Content-Type', contentType);
    if (file.size_bytes) res.setHeader('Content-Length', file.size_bytes);
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${encodeURIComponent(file.name)}"`);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const nodeStream = Readable.fromWeb(response.body);
    nodeStream.pipe(res);
  } catch (error) {
    next(error);
  }
};

exports.completeFileUpload = async (req, res, next) => {
  try {
    const { fileId, isNewVersion, storageKey, sizeBytes, isEncrypted, encryptionIv } = req.body;

    // Verify file exists and user has permission
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .single();

    if (fileError || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Check permission
    const isEditor = await checkFileEditor(fileId, req.user.id);
    if (!isEditor) {
      throw new AppError('Unauthorized to update this file', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    const updates = {
      storage_key: storageKey,
      size_bytes: sizeBytes,
      updated_at: new Date().toISOString()
    };
    if (isEncrypted !== undefined) updates.is_encrypted = isEncrypted;
    if (encryptionIv) updates.encryption_iv = encryptionIv;

    const performUpdate = async (updateObj) => {
      const { error: updateErr } = await supabase
        .from('files')
        .update(updateObj)
        .eq('id', file.id);

      if (updateErr && (updateErr.message.includes('is_encrypted') || updateErr.message.includes('column') || updateErr.message.includes('schema cache'))) {
        delete updateObj.is_encrypted;
        delete updateObj.encryption_iv;
        await supabase
          .from('files')
          .update(updateObj)
          .eq('id', file.id);
      }
    };

    if (isNewVersion) {
      // Get all version numbers for this file
      const { data: versions } = await supabase
        .from('file_versions')
        .select('version_number')
        .eq('file_id', file.id)
        .order('version_number', { ascending: false });

      const hasVersion1 = (versions || []).some(v => v.version_number === 1);
      if (!hasVersion1) {
        // Create missing Version 1 entry first using original file storage info
        await supabase
          .from('file_versions')
          .insert([{
            file_id: file.id,
            version_number: 1,
            storage_key: file.storage_key,
            size_bytes: file.size_bytes,
            created_at: file.created_at || new Date().toISOString()
          }]);
      }

      const maxVer = (versions && versions.length > 0) ? Math.max(...versions.map(v => v.version_number)) : 1;
      const nextVersion = maxVer + 1;

      const { data: newVersion, error: versionError } = await supabase
        .from('file_versions')
        .insert([{
          file_id: file.id,
          version_number: nextVersion,
          storage_key: storageKey,
          size_bytes: sizeBytes,
        }])
        .select('id')
        .single();

      if (versionError) {
        throw new AppError(versionError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }

      updates.version_id = newVersion.id;
      await performUpdate(updates);

    } else {
      // Create initial file version
      const { data: version, error: versionError } = await supabase
        .from('file_versions')
        .insert([{
          file_id: file.id,
          version_number: 1,
          storage_key: file.storage_key,
          size_bytes: file.size_bytes,
        }])
        .select('id')
        .single();

      if (versionError) {
        throw new AppError(versionError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }

      updates.version_id = version.id;
      await performUpdate(updates);
    }

    res.status(200).json({ status: 'success', message: 'Upload completed' });
  } catch (error) {
    next(error);
  }
};

exports.getFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify user has access to this file (owner, directly shared, or parent folder shared)
    const hasAccess = await checkFileAccess(id, req.user.id);
    if (!hasAccess) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    const { data: file, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .single();

    if (error || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    const host = req.get('host');
    const protocol = req.protocol;
    const signedUrl = `${protocol}://${host}/api/files/${file.id}/raw`;

    res.status(200).json({
      file: keysToCamel(file),
      signedUrl,
    });
  } catch (error) {
    next(error);
  }
};

exports.updateFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, folderId, isHidden } = req.body;

    const hasAccess = await checkFileAccess(id, req.user.id);
    if (!hasAccess) {
      throw new AppError('File not found or unauthorized', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    if (name || folderId !== undefined) {
      const isEditor = await checkFileEditor(id, req.user.id);
      if (!isEditor) {
        throw new AppError('File not found or unauthorized', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
    }

    if (folderId) {
      const { data: sourceFile } = await supabase.from('files').select('owner_id').eq('id', id).single();
      if (!sourceFile || sourceFile.owner_id !== req.user.id) {
        throw new AppError('Only the file owner can move files', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
      const folderRole = await getFolderShareRole(folderId, req.user.id);
      if (folderRole !== 'owner' && folderRole !== 'editor') {
        throw new AppError('Unauthorized to edit target folder', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
    }

    if (isHidden !== undefined) {
      if (isHidden) {
        const { error: upsertErr } = await supabase
          .from('user_hidden_items')
          .upsert([{ user_id: req.user.id, resource_type: 'file', resource_id: id }]);
        if (upsertErr) {
          console.error("user_hidden_items upsert failed, updating legacy is_hidden column:", upsertErr.message);
          await supabase.from('files').update({ is_hidden: true }).eq('id', id);
        }
      } else {
        await supabase
          .from('user_hidden_items')
          .delete()
          .eq('user_id', req.user.id)
          .eq('resource_type', 'file')
          .eq('resource_id', id);
        await supabase.from('files').update({ is_hidden: false }).eq('id', id);
      }
    }

    let data = null;
    if (name || folderId !== undefined) {
      const updates = {};
      if (name) {
        // Fetch current file name to preserve original file extension
        const { data: existingFile } = await supabase
          .from('files')
          .select('name')
          .eq('id', id)
          .single();

        if (existingFile && existingFile.name) {
          const lastDotIdx = existingFile.name.lastIndexOf('.');
          if (lastDotIdx > 0 && lastDotIdx < existingFile.name.length - 1) {
            const originalExt = existingFile.name.slice(lastDotIdx); // e.g. ".pdf"
            let sanitizedBase = name.trim();
            if (sanitizedBase.toLowerCase().endsWith(originalExt.toLowerCase())) {
              updates.name = sanitizedBase;
            } else {
              const newLastDot = sanitizedBase.lastIndexOf('.');
              if (newLastDot > 0) {
                sanitizedBase = sanitizedBase.slice(0, newLastDot);
              }
              updates.name = `${sanitizedBase}${originalExt}`;
            }
          } else {
            updates.name = name.trim();
          }
        } else {
          updates.name = name.trim();
        }
      }
      if (folderId !== undefined) updates.folder_id = folderId;
      updates.updated_at = new Date().toISOString();

      const { data: updatedData, error } = await supabase
        .from('files')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error || !updatedData) {
        throw new AppError('File update failed', ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }
      data = updatedData;
    } else {
      const { data: existingData } = await supabase
        .from('files')
        .select('*')
        .eq('id', id)
        .single();
      data = existingData;
    }

    // Log rename/move activity here...

    const { hiddenFileIds } = await getPersonalHiddenIds(req.user.id);
    const result = {
      ...data,
      isHidden: isHidden !== undefined ? isHidden : hiddenFileIds.includes(data?.id)
    };

    res.status(200).json(keysToCamel(result));
  } catch (error) {
    next(error);
  }
};

exports.deleteFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const isEditor = await checkFileEditor(id, req.user.id);
    if (!isEditor) {
      throw new AppError('File not found or unauthorized', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    // Soft delete
    const { data, error } = await supabase
      .from('files')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('File not found or delete failed', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Log delete activity here...

    res.status(200).json({ status: 'success', message: 'File deleted' });
  } catch (error) {
    next(error);
  }
};

exports.getFileVersions = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify user has editor or owner access to view version history
    const isEditor = await checkFileEditor(id, req.user.id);
    if (!isEditor) {
      throw new AppError('File not found or unauthorized to view version history', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    const { data: file } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .single();

    let { data: versions, error: versionError } = await supabase
      .from('file_versions')
      .select('*')
      .eq('file_id', id)
      .order('version_number', { ascending: false });

    if (versionError) {
      throw new AppError(versionError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    // Auto-heal missing Version 1 entry if history exists but Version 1 is missing
    const hasVersion1 = (versions || []).some(v => v.version_number === 1);
    if (!hasVersion1 && file) {
      const { data: v1 } = await supabase
        .from('file_versions')
        .insert([{
          file_id: file.id,
          version_number: 1,
          storage_key: file.storage_key,
          size_bytes: file.size_bytes,
          created_at: file.created_at || new Date().toISOString()
        }])
        .select('*')
        .single();

      if (v1) {
        const { data: refreshedVersions } = await supabase
          .from('file_versions')
          .select('*')
          .eq('file_id', id)
          .order('version_number', { ascending: false });
        versions = refreshedVersions || [...(versions || []), v1];
      }
    }

    res.status(200).json(keysToCamel(versions || []));
  } catch (error) {
    next(error);
  }
};

exports.restoreFileVersion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { versionId } = req.body;

    if (!versionId) {
      throw new AppError('Version ID is required', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // Verify editor access (owner, directly shared editor, or parent folder editor)
    const isEditor = await checkFileEditor(id, req.user.id);
    if (!isEditor) {
      throw new AppError('File not found or unauthorized', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    // Get the version details
    const { data: version, error: versionError } = await supabase
      .from('file_versions')
      .select('*')
      .eq('id', versionId)
      .eq('file_id', id)
      .single();

    if (versionError || !version) {
      throw new AppError('Version not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Update the pointer
    const { error: updateError } = await supabase
      .from('files')
      .update({
        version_id: version.id,
        storage_key: version.storage_key,
        size_bytes: version.size_bytes,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) {
      throw new AppError(updateError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({ status: 'success', message: 'Version restored successfully' });
  } catch (error) {
    next(error);
  }
};

exports.getRecentFiles = async (req, res, next) => {
  try {
    const { data: files, error } = await supabase
      .from('files')
      .select('*')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json(keysToCamel(files));
  } catch (error) {
    next(error);
  }
};

exports.copyFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { folderId } = req.body; // target folder id

    // Verify user has access to this file (owner, editor, or viewer)
    const hasAccess = await checkFileAccess(id, req.user.id);
    if (!hasAccess) {
      throw new AppError('File not found or unauthorized', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    // Get source file details
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .single();

    if (fileError || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Determine target folder: verify user can write to target folder if provided, else copy to root
    let targetFolderId = null;
    if (folderId) {
      const folderRole = await getFolderShareRole(folderId, req.user.id);
      if (folderRole === 'owner' || folderRole === 'editor') {
        targetFolderId = folderId;
      }
    }

    // Check for name collision in target location for current user
    let query = supabase
      .from('files')
      .select('name')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);

    if (targetFolderId) {
      query = query.eq('folder_id', targetFolderId);
    } else {
      query = query.is('folder_id', null);
    }

    const { data: existingFiles } = await query;
    const existingNames = new Set((existingFiles || []).map(f => f.name));

    const extIndex = file.name.lastIndexOf('.');
    let namePart = file.name;
    let extPart = '';
    if (extIndex > -1) {
      namePart = file.name.substring(0, extIndex);
      extPart = file.name.substring(extIndex);
    }

    let newName = `Copy of ${file.name}`;
    let counter = 2;
    while (existingNames.has(newName)) {
      newName = `Copy (${counter}) of ${namePart}${extPart}`;
      counter++;
    }

    // Duplicate physical asset in Telegram storage so it is a completely independent entity
    let newStorageKey = file.storage_key;
    try {
      if (file.storage_key) {
        const parts = file.storage_key.split(':');
        const sourceTelegramFileId = (parts.length >= 2 && parts[0] === 'tg') ? parts[1] : file.storage_key;

        const { response } = await getTelegramFileStream(sourceTelegramFileId);
        const arrayBuf = await response.arrayBuffer();
        const fileBuf = Buffer.from(arrayBuf);

        const { fileId: copyTgFileId, messageId: copyTgMsgId } = await uploadToTelegram(
          fileBuf,
          newName,
          file.mime_type || 'application/octet-stream'
        );
        newStorageKey = `tg:${copyTgFileId}:${copyTgMsgId}`;
      }
    } catch (copyErr) {
      console.warn('Telegram asset duplication warning:', copyErr.message || copyErr);
    }

    // Insert new independent file record owned by req.user.id
    const insertPayload = {
      name: newName,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      storage_key: newStorageKey,
      owner_id: req.user.id,
      folder_id: targetFolderId,
    };

    if (file.is_encrypted !== undefined) insertPayload.is_encrypted = file.is_encrypted;
    if (file.encryption_iv) insertPayload.encryption_iv = file.encryption_iv;

    let { data: newFile, error: insertError } = await supabase
      .from('files')
      .insert([insertPayload])
      .select()
      .single();

    if (insertError) {
      if (insertError.message && (insertError.message.includes('is_encrypted') || insertError.message.includes('column'))) {
        delete insertPayload.is_encrypted;
        delete insertPayload.encryption_iv;
        const retry = await supabase
          .from('files')
          .insert([insertPayload])
          .select()
          .single();
        newFile = retry.data;
        insertError = retry.error;
      }
    }

    if (insertError) {
      throw new AppError(insertError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    // Create initial file version for the copy
    const { data: version, error: versionError } = await supabase
      .from('file_versions')
      .insert([{
        file_id: newFile.id,
        version_number: 1,
        storage_key: newStorageKey,
        size_bytes: file.size_bytes,
      }])
      .select('id')
      .single();

    if (!versionError && version) {
      await supabase
        .from('files')
        .update({ version_id: version.id })
        .eq('id', newFile.id);
      newFile.version_id = version.id;
    }

    res.status(200).json(keysToCamel(newFile));
  } catch (error) {
    next(error);
  }
};

exports.getDeviceSyncStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Find Mobile Uploads and Laptop Uploads folders for this user
    let mobileFolderId = null;
    let laptopFolderId = null;

    try {
      const { data: userFolders } = await supabase
        .from('folders')
        .select('id, name')
        .eq('owner_id', userId)
        .eq('is_deleted', false)
        .in('name', ['Mobile Uploads', 'Laptop Uploads']);

      if (userFolders) {
        mobileFolderId = userFolders.find(f => f.name === 'Mobile Uploads')?.id || null;
        laptopFolderId = userFolders.find(f => f.name === 'Laptop Uploads')?.id || null;
      }

      // Auto-create Mobile Uploads folder if not exists
      if (!mobileFolderId) {
        const { data: createdMobile } = await supabase
          .from('folders')
          .insert([{ name: 'Mobile Uploads', owner_id: userId, parent_id: null }])
          .select('id')
          .single();
        if (createdMobile) mobileFolderId = createdMobile.id;
      }

      // Auto-create Laptop Uploads folder if not exists
      if (!laptopFolderId) {
        const { data: createdLaptop } = await supabase
          .from('folders')
          .insert([{ name: 'Laptop Uploads', owner_id: userId, parent_id: null }])
          .select('id')
          .single();
        if (createdLaptop) laptopFolderId = createdLaptop.id;
      }

      // Auto-migrate legacy unassigned device sync files (folder_id is null) into their folders
      if (mobileFolderId) {
        await supabase
          .from('files')
          .update({ folder_id: mobileFolderId })
          .eq('owner_id', userId)
          .is('folder_id', null)
          .eq('is_deleted', false)
          .or('source_device.eq.mobile,and(is_device_sync.eq.true,source_device.neq.laptop)');
      }
      if (laptopFolderId) {
        await supabase
          .from('files')
          .update({ folder_id: laptopFolderId })
          .eq('owner_id', userId)
          .is('folder_id', null)
          .eq('is_deleted', false)
          .or('source_device.eq.laptop,source_device.eq.desktop');
      }
    } catch (fErr) {
      console.error("Error fetching/creating device sync folders:", fErr);
    }

    let files = [];
    try {
      const { data, error } = await supabase
        .from('files')
        .select('id, name, mime_type, size_bytes, source_device, is_device_sync, created_at, folder_id')
        .eq('owner_id', userId)
        .eq('is_deleted', false);

      if (!error && data) {
        files = data;
      }
    } catch (e) {
      // Fallback
    }

    const mobileFiles = files.filter(f =>
      (mobileFolderId && f.folder_id === mobileFolderId) ||
      f.source_device === 'mobile' ||
      (f.is_device_sync && f.source_device !== 'laptop')
    );

    const laptopFiles = files.filter(f =>
      (laptopFolderId && f.folder_id === laptopFolderId) ||
      f.source_device === 'laptop' ||
      f.source_device === 'desktop'
    );

    const totalSyncedFiles = files.filter(f =>
      f.is_device_sync ||
      (mobileFolderId && f.folder_id === mobileFolderId) ||
      (laptopFolderId && f.folder_id === laptopFolderId) ||
      ['mobile', 'laptop', 'desktop'].includes(f.source_device)
    );

    const mobileBytes = mobileFiles.reduce((acc, f) => acc + Number(f.size_bytes || 0), 0);
    const laptopBytes = laptopFiles.reduce((acc, f) => acc + Number(f.size_bytes || 0), 0);
    const totalBytes = totalSyncedFiles.reduce((acc, f) => acc + Number(f.size_bytes || 0), 0);

    let syncLogs = [];
    try {
      const { data: logsData } = await supabase
        .from('device_sync_logs')
        .select('*')
        .eq('user_id', userId)
        .order('synced_at', { ascending: false })
        .limit(10);
      if (logsData) syncLogs = logsData;
    } catch (logErr) {
      // Table might not exist yet
    }

    res.status(200).json({
      mobileFolderId,
      laptopFolderId,
      mobile: {
        filesCount: mobileFiles.length,
        totalBytes: mobileBytes
      },
      laptop: {
        filesCount: laptopFiles.length,
        totalBytes: laptopBytes
      },
      total: {
        filesCount: totalSyncedFiles.length,
        totalBytes: totalBytes
      },
      recentLogs: keysToCamel(syncLogs),
      syncedFiles: keysToCamel(totalSyncedFiles.slice(0, 20)),
      syncedFileNames: Array.from(new Set(files.map(f => f.name.toLowerCase())))
    });
  } catch (error) {
    next(error);
  }
};

exports.recordDeviceSyncLog = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { deviceType, deviceName, filesCount, totalBytes } = req.body;

    let logData = null;
    try {
      const { data, error } = await supabase
        .from('device_sync_logs')
        .insert([{
          user_id: userId,
          device_type: deviceType || 'unknown',
          device_name: deviceName || 'Device',
          files_count: filesCount || 0,
          total_bytes: totalBytes || 0,
          synced_at: new Date().toISOString()
        }])
        .select()
        .single();
      if (!error && data) logData = data;
    } catch (e) {
      // Ignore if table not present
    }

    res.status(200).json({ success: true, log: logData ? keysToCamel(logData) : null });
  } catch (error) {
    next(error);
  }
};

