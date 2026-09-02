const { AppError, ERROR_CODES } = require('../utils/error');

/**
 * Middleware to verify Cloudflare Turnstile token for sensitive authentication requests.
 */
const verifyTurnstile = async (req, res, next) => {
  try {
    // Optional kill switch for Turnstile verification via environment variable
    if (process.env.TURNSTILE_ENABLED === 'false') {
      return next();
    }

    const secretKey = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';
    const token = req.body?.turnstileToken || req.body?.['cf-turnstile-response'] || req.headers['x-turnstile-token'];

    if (!secretKey) {
      return next();
    }

    if (!token) {
      throw new AppError(
        'Turnstile verification token is missing. Please complete the "Not a Robot" security check.',
        ERROR_CODES.BAD_REQUEST.status,
        ERROR_CODES.BAD_REQUEST.code
      );
    }

    const formData = new URLSearchParams();
    formData.append('secret', secretKey.trim());
    formData.append('response', token.trim());

    const remoteIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (remoteIp && !remoteIp.includes('127.0.0.1') && remoteIp !== '::1' && remoteIp !== '::ffff:127.0.0.1') {
      formData.append('remoteip', remoteIp);
    }

    // Verify token with Cloudflare Turnstile API
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const data = await response.json();

    if (!data.success) {
      console.error('Cloudflare Turnstile siteverify failed:', data['error-codes'] || data);
      throw new AppError(
        'Security verification failed. Please try the "Not a Robot" check again.',
        ERROR_CODES.BAD_REQUEST.status,
        ERROR_CODES.BAD_REQUEST.code
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  verifyTurnstile,
};
