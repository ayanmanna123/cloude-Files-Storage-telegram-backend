const jwt = require('jsonwebtoken');
const { AppError, ERROR_CODES } = require('../utils/error');
const supabase = require('../config/supabase');

const protect = async (req, res, next) => {
  try {
    let token = req.cookies.jwt;

    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new AppError('Not authorized to access this route', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user still exists
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, image_url, secret_code')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      throw new AppError('The user belonging to this token no longer exists.', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(new AppError('Invalid token. Please log in again.', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code));
    } else if (error.name === 'TokenExpiredError') {
      next(new AppError('Your token has expired. Please log in again.', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code));
    } else {
      next(error);
    }
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    let token = req.cookies.jwt;
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return next();
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, image_url, secret_code')
      .eq('id', decoded.id)
      .single();

    if (!error && user) {
      req.user = user;
    }
    next();
  } catch (error) {
    next();
  }
};

module.exports = { protect, optionalAuth };

