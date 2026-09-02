const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');

exports.createLinkShare = async (req, res, next) => {
  try {
    const { resourceType, resourceId, expiresAt, password } = req.body;

    if (!resourceType || !resourceId) {
      throw new AppError('Missing resource type or id', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const token = crypto.randomBytes(16).toString('hex');
    let passwordHash = null;

    if (password) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password, salt);
    }

    const { data, error } = await supabase
      .from('link_shares')
      .insert([
        {
          resource_type: resourceType,
          resource_id: resourceId,
          token,
          password_hash: passwordHash,
          expires_at: expiresAt || null,
          created_by: req.user.id,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    const responseData = keysToCamel(data);
    responseData.passwordHash = undefined; // Do not return hash
    res.status(201).json(responseData);
  } catch (error) {
    next(error);
  }
};

exports.getLinkForResource = async (req, res, next) => {
  try {
    const { resourceType, resourceId } = req.params;

    const { data, error } = await supabase
      .from('link_shares')
      .select('*')
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      // Only the person who created the link (or anyone with access? For now restrict to created_by)
      // We can remove eq('created_by') if we want any editor to see it
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found is fine
        return res.status(200).json(null);
      }
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    const responseData = keysToCamel(data);
    responseData.passwordHash = undefined;
    res.status(200).json(responseData);
  } catch (error) {
    next(error);
  }
};

exports.getLink = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.query; // If password is required, client might send it in query or body

    const { data: link, error } = await supabase
      .from('link_shares')
      .select('*')
      .eq('token', token)
      .single();

    if (error || !link) {
      throw new AppError('Link not found or invalid', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Check expiration
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new AppError('This link has expired', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    // Check password
    if (link.password_hash) {
      if (!password) {
        throw new AppError('Password required to access this link', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
      }
      const isMatch = await bcrypt.compare(password, link.password_hash);
      if (!isMatch) {
        throw new AppError('Incorrect password', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
      }
    }

    // Fetch the actual resource data
    let resourceData = null;
    let folderFiles = [];
    
    if (link.resource_type === 'file') {
      const { data: file } = await supabase
        .from('files')
        .select('*')
        .eq('id', link.resource_id)
        .eq('is_deleted', false)
        .single();
      resourceData = file;
    } else if (link.resource_type === 'folder') {
      const { data: folder } = await supabase
        .from('folders')
        .select('*')
        .eq('id', link.resource_id)
        .eq('is_deleted', false)
        .single();
      resourceData = folder;
      
      // Fetch files inside the folder so the frontend can zip them
      const { data: files } = await supabase
        .from('files')
        .select('*')
        .eq('folder_id', link.resource_id)
        .eq('is_deleted', false);
      if (files) {
        folderFiles = files;
      }
    }

    if (!resourceData) {
      throw new AppError('Link not found or invalid', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    let savedToSharedWithMe = false;
    if (req.user && resourceData) {
      const resourceOwnerId = resourceData.owner_id || link.created_by;
      if (req.user.id !== resourceOwnerId) {
        const { error: shareErr } = await supabase
          .from('shares')
          .insert([
            {
              resource_type: link.resource_type,
              resource_id: link.resource_id,
              grantee_user_id: req.user.id,
              role: link.role || 'viewer',
              created_by: resourceOwnerId
            }
          ]);

        if (!shareErr || shareErr.code === '23505') {
          savedToSharedWithMe = true;
        }
      }
    }

    res.status(200).json(keysToCamel({
      ...link,
      password_hash: undefined, // ensure we don't leak hash
      resource: resourceData,
      files: folderFiles, // return files so frontend can zip
      savedToSharedWithMe
    }));
  } catch (error) {
    next(error);
  }
};

exports.deleteLinkShare = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('link_shares')
      .delete()
      .eq('id', id)
      .eq('created_by', req.user.id);

    if (error) {
      throw new AppError('Failed to delete link', ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({ status: 'success', message: 'Link deleted' });
  } catch (error) {
    next(error);
  }
};

exports.createBundleShare = async (req, res, next) => {
  try {
    const { fileIds, expiresAt, password } = req.body;

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      throw new AppError('Missing fileIds', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const token = crypto.randomBytes(16).toString('hex');
    let passwordHash = null;

    if (password) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password, salt);
    }

    const { data, error } = await supabase
      .from('bundle_shares')
      .insert([
        {
          file_ids: fileIds,
          token,
          password_hash: passwordHash,
          expires_at: expiresAt || null,
          created_by: req.user.id,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    const responseData = keysToCamel(data);
    responseData.passwordHash = undefined;
    res.status(201).json(responseData);
  } catch (error) {
    next(error);
  }
};

exports.getBundleShare = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.query;

    const { data: bundle, error } = await supabase
      .from('bundle_shares')
      .select('*')
      .eq('token', token)
      .single();

    if (error || !bundle) {
      throw new AppError('Link not found or invalid', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    if (bundle.expires_at && new Date(bundle.expires_at) < new Date()) {
      throw new AppError('This link has expired', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    if (bundle.password_hash) {
      if (!password) {
        throw new AppError('Password required to access this link', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
      }
      const isMatch = await bcrypt.compare(password, bundle.password_hash);
      if (!isMatch) {
        throw new AppError('Incorrect password', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
      }
    }

    // Fetch all active, non-hidden files in the bundle
    const { data: files } = await supabase
      .from('files')
      .select('*')
      .in('id', bundle.file_ids)
      .eq('is_deleted', false)
      .eq('is_hidden', false);

    let savedToSharedWithMe = false;
    if (req.user && files && files.length > 0) {
      for (const file of files) {
        const fileOwnerId = file.owner_id || bundle.created_by;
        if (req.user.id !== fileOwnerId) {
          const { error: shareErr } = await supabase
            .from('shares')
            .insert([
              {
                resource_type: 'file',
                resource_id: file.id,
                grantee_user_id: req.user.id,
                role: 'viewer',
                created_by: fileOwnerId
              }
            ]);
          if (!shareErr || shareErr.code === '23505') {
            savedToSharedWithMe = true;
          }
        }
      }
    }

    res.status(200).json(keysToCamel({
      ...bundle,
      password_hash: undefined,
      files: files || [],
      savedToSharedWithMe
    }));
  } catch (error) {
    next(error);
  }
};
