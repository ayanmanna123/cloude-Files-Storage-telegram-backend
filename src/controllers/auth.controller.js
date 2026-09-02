const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const supabase = require('../config/supabase');
const { AppError, ERROR_CODES } = require('../utils/error');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const rpName = 'Cloud Based Media Storage';

const getRpIdAndOrigin = (req) => {
  if (process.env.RP_ID) {
    const rawOrigin = process.env.CLIENT_URL || req.get('origin') || (req.get('referer') ? new URL(req.get('referer')).origin : null) || `http://${process.env.RP_ID}:5173`;
    return { rpID: process.env.RP_ID, origin: rawOrigin };
  }

  let rawClientUrl = req.get('origin');
  if (!rawClientUrl && req.get('referer')) {
    try {
      rawClientUrl = new URL(req.get('referer')).origin;
    } catch (e) {}
  }
  if (!rawClientUrl && process.env.CLIENT_URL) {
    rawClientUrl = process.env.CLIENT_URL;
  }

  let hostname = 'localhost';
  let fullOrigin = 'http://localhost:5173';

  if (rawClientUrl) {
    try {
      const parsedUrl = new URL(rawClientUrl);
      hostname = parsedUrl.hostname;
      fullOrigin = parsedUrl.origin;
    } catch (e) {
      console.error("Failed to parse client URL:", e);
    }
  } else {
    const hostHeader = req.get('host') || 'localhost';
    hostname = hostHeader.split(':')[0];
    fullOrigin = `http://${hostname}:5173`;
  }

  return { rpID: hostname, origin: fullOrigin };
};

const extractPasskeyPayload = (reqBody) => {
  if (!reqBody) return null;
  if (reqBody.id && (reqBody.rawId || reqBody.type)) return reqBody;
  if (reqBody.body && reqBody.body.id) return reqBody.body;
  if (reqBody.credential && reqBody.credential.id) return reqBody.credential;
  if (reqBody.response && reqBody.response.id) return reqBody.response;
  return reqBody;
};

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '7d', // Token expires in 7 days
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user.id);

  const cookieOptions = {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  };

  res.cookie('jwt', token, cookieOptions);

  // Remove password from output
  user.password_hash = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    user,
  });
};

exports.register = async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      throw new AppError('Please provide name, email, and password', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // 1. Check if user exists
    const { data: existingUser } = await supabase.from('users').select('id').eq('email', email).single();
    
    if (existingUser) {
      throw new AppError('Email is already in use', ERROR_CODES.CONFLICT.status, ERROR_CODES.CONFLICT.code);
    }

    // 2. Hash password, create verification token, and generate Gravatar
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    // Generate Gravatar URL from email
    const emailLower = email.trim().toLowerCase();
    const md5Hash = crypto.createHash('md5').update(emailLower).digest('hex');
    const imageUrl = `https://www.gravatar.com/avatar/${md5Hash}?d=identicon`;

    // 3. Create user (is_verified defaults to false)
    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{ 
        email, 
        name, 
        password_hash: passwordHash,
        verification_token: verificationToken,
        image_url: imageUrl
      }])
      .select('id, email, name, image_url, created_at')
      .single();

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    // 4. Send Verification Email (await for Serverless compatibility)
    try {
      await sendVerificationEmail(email, verificationToken, req);
    } catch (emailErr) {
      console.error("Verification email send error:", emailErr);
    }

    res.status(201).json({
      status: 'success',
      message: 'Registration successful. Please check your email to verify your account.',
      user: newUser
    });
  } catch (error) {
    next(error);
  }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const token = req.params.token || req.query.token;

    if (!token) {
      throw new AppError('Verification token is missing', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // 1. Find user with this token
    const { data: user } = await supabase
      .from('users')
      .select('id, is_verified')
      .eq('verification_token', token)
      .single();

    if (user) {
      // Update user to verified
      await supabase
        .from('users')
        .update({ is_verified: true, verification_token: null })
        .eq('id', user.id);

      return res.status(200).json({
        status: 'success',
        message: 'Email successfully verified. You can now log in.'
      });
    }

    // 2. Token already consumed / cleared by prior request (e.g. React StrictMode double-fetch)
    return res.status(200).json({
      status: 'success',
      message: 'Email is already verified. You can now log in.'
    });
  } catch (error) {
    next(error);
  }
};

exports.googleLogin = async (req, res, next) => {
  try {
    const { token: googleToken } = req.body;

    if (!googleToken) {
      throw new AppError('Google token is missing', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // Verify token with Google
    const ticket = await googleClient.verifyIdToken({
      idToken: googleToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    // Check if user exists
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user) {
      // Create user if they don't exist
      // Give them a random password since they login via Google
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(randomPassword, salt);

      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{ 
          email, 
          name, 
          password_hash: passwordHash,
          is_verified: true, // Auto-verify Google emails
          image_url: picture
        }])
        .select('*')
        .single();

      if (insertError) {
        throw new AppError('Failed to create account via Google', ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }
      user = newUser;
    } else {
      // User exists. Update avatar if they don't have one, or make sure they are verified
      const updates = {};
      if (!user.is_verified) updates.is_verified = true;
      if (!user.image_url && picture) updates.image_url = picture;
      
      if (Object.keys(updates).length > 0) {
        await supabase.from('users').update(updates).eq('id', user.id);
        user = { ...user, ...updates };
      }
    }

    // Log the user in
    const token = signToken(user.id);

    // Default expiration to 30 days if env is missing
    const expiresDays = process.env.JWT_COOKIE_EXPIRES_IN || 30;
    
    res.cookie('jwt', token, {
      expires: new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    res.status(200).json({
      status: 'success',
      token,
      user: { id: user.id, name: user.name, email: user.email, image_url: user.image_url }
    });

  } catch (error) {
    console.error("Google Auth Error:", error);
    next(new AppError('Invalid Google authentication', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code));
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Please provide email and password', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // 1. Find user
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      throw new AppError('Incorrect email or password', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
    }

    // 2. Check if verified
    if (!user.is_verified) {
      throw new AppError('Please verify your email before logging in', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
    }

    // 3. Check password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!isMatch) {
      throw new AppError('Incorrect email or password', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
    }

    createSendToken(user, 200, res);
  } catch (error) {
    next(error);
  }
};

exports.logout = (req, res) => {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    expires: new Date(0),
  };
  res.cookie('jwt', '', cookieOptions);
  res.clearCookie('jwt', cookieOptions);
  res.status(200).json({ status: 'success' });
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Please provide an email', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // 1. Check if user exists
    const { data: user, error } = await supabase
      .from('users')
      .select('id, is_verified')
      .eq('email', email)
      .single();

    if (error || !user) {
      // We still return success to not leak which emails are registered
      return res.status(200).json({ status: 'success', message: 'If that email exists, a reset link was sent.' });
    }

    // 2. Generate reset token and expiration (1 hour from now)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    // 3. Save to DB
    const { error: updateError } = await supabase
      .from('users')
      .update({ reset_password_token: resetToken, reset_password_expires: resetTokenExpires })
      .eq('id', user.id);

    if (updateError) {
      throw new AppError('Failed to process password reset', ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    // 4. Send Email (await for Serverless compatibility)
    try {
      await sendPasswordResetEmail(email, resetToken, req);
    } catch (emailErr) {
      console.error("Password reset email error:", emailErr);
    }

    res.status(200).json({ status: 'success', message: 'If that email exists, a reset link was sent.' });
  } catch (error) {
    next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      throw new AppError('Token and new password are required', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // 1. Find user by token and ensure it hasn't expired
    const { data: user, error } = await supabase
      .from('users')
      .select('id')
      .eq('reset_password_token', token)
      .gte('reset_password_expires', new Date().toISOString())
      .single();

    if (error || !user) {
      throw new AppError('Token is invalid or has expired', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // 2. Hash new password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Update password and clear reset fields
    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        password_hash: passwordHash, 
        reset_password_token: null, 
        reset_password_expires: null 
      })
      .eq('id', user.id);

    if (updateError) {
      throw new AppError('Failed to reset password', ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({ status: 'success', message: 'Password has been reset successfully. You can now log in.' });
  } catch (error) {
    next(error);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    // User is already attached to req by auth.middleware
    // Calculate storage used
    const { data: files, error: filesError } = await supabase
      .from('files')
      .select('id, size_bytes')
      .eq('owner_id', req.user.id);

    let storageUsed = 0;
    if (filesError) {
      console.error('Supabase error fetching files for storage:', filesError);
    }
    
    if (!filesError && files && files.length > 0) {
      const fileIds = files.map(f => f.id);
      const { data: versions, error: versionsError } = await supabase
        .from('file_versions')
        .select('file_id, size_bytes')
        .in('file_id', fileIds);

      if (versionsError) {
        console.error('Supabase error fetching file_versions for storage:', versionsError);
      }

      const versionsByFile = {};
      if (!versionsError && versions) {
        for (const v of versions) {
          if (!versionsByFile[v.file_id]) versionsByFile[v.file_id] = [];
          versionsByFile[v.file_id].push(v);
        }
      }

      storageUsed = files.reduce((acc, file) => {
        const fileVersions = versionsByFile[file.id];
        if (fileVersions && fileVersions.length > 0) {
          return acc + fileVersions.reduce((vAcc, v) => vAcc + (Number(v.size_bytes) || 0), 0);
        }
        return acc + (Number(file.size_bytes) || 0);
      }, 0);
    }

    // Default storage limit: 50 MB
    const storageLimit = 50 * 1024 * 1024;

    // Check passkey status
    const { count: passkeyCount } = await supabase
      .from('passkeys')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id);

    const hasPasskey = Boolean(passkeyCount && passkeyCount > 0);

    res.status(200).json({
      user: {
        ...req.user,
        secretCode: req.user.secret_code,
        hasPasskey,
        storageUsed,
        storageLimit
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.updateSecretCode = async (req, res, next) => {
  try {
    const { secretCode } = req.body;

    if (!secretCode) {
      throw new AppError('Secret code is required', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const { error } = await supabase
      .from('users')
      .update({ secret_code: secretCode })
      .eq('id', req.user.id);

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({
      status: 'success',
      message: 'Secret code updated successfully',
      secretCode,
    });
  } catch (error) {
    next(error);
  }
};

exports.generatePasskeyRegistrationOptions = async (req, res, next) => {
  try {
    const user = req.user;
    const { rpID } = getRpIdAndOrigin(req);

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new Uint8Array(Buffer.from(user.id)),
      userName: user.email,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
    });

    await supabase.from('users').update({ current_challenge: options.challenge }).eq('id', user.id);

    res.status(200).json(options);
  } catch (error) {
    next(error);
  }
};

exports.verifyPasskeyRegistration = async (req, res, next) => {
  try {
    const user = req.user;
    const authResponse = extractPasskeyPayload(req.body);
    const { rpID, origin } = getRpIdAndOrigin(req);

    if (!authResponse || !authResponse.id) {
      throw new AppError('Invalid passkey response payload', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const { data: dbUser } = await supabase.from('users').select('current_challenge').eq('id', user.id).single();
    if (!dbUser || !dbUser.current_challenge) {
      throw new AppError('Registration challenge not found', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const verification = await verifyRegistrationResponse({
      response: authResponse,
      expectedChallenge: dbUser.current_challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (verification.verified && verification.registrationInfo) {
      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

      const { error } = await supabase.from('passkeys').insert([{
        user_id: user.id,
        webauthn_user_id: user.id,
        credential_id: credential.id, // Base64URL string in v13
        public_key: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        device_type: credentialDeviceType,
        backed_up: credentialBackedUp,
        transports: credential.transports,
      }]);

      if (error) {
        throw new AppError('Failed to save passkey', ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }

      // Clear challenge
      await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);

      res.status(200).json({ verified: true });
    } else {
      res.status(400).json({ verified: false, error: 'Passkey verification failed' });
    }
  } catch (error) {
    next(error);
  }
};

exports.generatePasskeyLoginOptions = async (req, res, next) => {
  try {
    const { email } = req.body;
    const { rpID } = getRpIdAndOrigin(req);

    let user;
    if (email) {
      const { data } = await supabase.from('users').select('id, email').eq('email', email).single();
      if (!data) {
        throw new AppError('User not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
      }
      user = data;
    }

    let allowCredentials = [];
    if (user) {
      const { data: passkeys } = await supabase.from('passkeys').select('credential_id, transports').eq('user_id', user.id);
      if (passkeys && passkeys.length > 0) {
        allowCredentials = passkeys.map(pk => ({
          id: pk.credential_id,
          transports: pk.transports || ['internal'],
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    if (user) {
      await supabase.from('users').update({ current_challenge: options.challenge }).eq('id', user.id);
    } else {
      // Store in cookie for identifier-first or auto-fill flows
      res.cookie('passkey_challenge', options.challenge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 5 * 60 * 1000,
      });
    }

    res.status(200).json(options);
  } catch (error) {
    next(error);
  }
};

exports.verifyPasskeyLogin = async (req, res, next) => {
  try {
    const { email } = req.body;
    const authResponse = extractPasskeyPayload(req.body);

    if (!authResponse || !authResponse.id) {
      throw new AppError('Invalid passkey response payload', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const { rpID, origin } = getRpIdAndOrigin(req);
    let challenge = req.cookies.passkey_challenge;

    let user;
    if (email) {
      const { data } = await supabase.from('users').select('*').eq('email', email).single();
      if (!data) {
        throw new AppError('User not found', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
      }
      user = data;
      challenge = user.current_challenge;
    }

    if (!challenge) {
      throw new AppError('Login challenge not found', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // Find passkey by credential id
    const { data: passkey } = await supabase.from('passkeys').select('*').eq('credential_id', authResponse.id).single();

    if (!passkey) {
       throw new AppError('Passkey not found', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
    }

    // If email wasn't provided (e.g. conditional UI autofill), fetch user from passkey
    if (!user) {
       const { data } = await supabase.from('users').select('*').eq('id', passkey.user_id).single();
       if (!data) throw new AppError('User not found', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
       user = data;
       challenge = user.current_challenge || req.cookies.passkey_challenge;
    }

    const verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(Buffer.from(passkey.public_key, 'base64')),
        counter: passkey.counter,
        transports: passkey.transports,
      }
    });

    if (verification.verified && verification.authenticationInfo) {
      const { newCounter } = verification.authenticationInfo;

      await supabase.from('passkeys').update({ counter: newCounter }).eq('id', passkey.id);
      await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);
      res.clearCookie('passkey_challenge');

      createSendToken(user, 200, res);
    } else {
      res.status(400).json({ verified: false, error: 'Passkey verification failed' });
    }
  } catch (error) {
    next(error);
  }
};
