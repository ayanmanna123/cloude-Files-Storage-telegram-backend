const supabase = require('../config/supabase');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');

exports.searchUsers = async (req, res, next) => {
  try {
    const { q } = req.query;

    let query = supabase
      .from('users')
      .select('id, name, email, image_url')
      .neq('id', req.user.id);

    if (q && q.trim()) {
      const searchTerm = q.trim();
      query = query.or(`email.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%`);
    }

    const { data, error } = await query.limit(10);

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json(keysToCamel(data || []));
  } catch (error) {
    next(error);
  }
};
