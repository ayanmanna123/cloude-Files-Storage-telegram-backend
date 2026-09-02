const nodemailer = require('nodemailer');
const EMAIL_USER_FALLBACK = 'mannaayan777@gmail.com';
const EMAIL_PASS_FALLBACK = 'smmvrxbvljlgglfq';

const getFrontendUrl = (reqOrUrl) => {
  if (typeof reqOrUrl === 'string' && reqOrUrl.trim()) {
    return reqOrUrl.trim().replace(/\/$/, '');
  }

  if (reqOrUrl && typeof reqOrUrl === 'object') {
    if (reqOrUrl.body && typeof reqOrUrl.body.frontendUrl === 'string' && reqOrUrl.body.frontendUrl.trim()) {
      return reqOrUrl.body.frontendUrl.trim().replace(/\/$/, '');
    }
    if (reqOrUrl.body && typeof reqOrUrl.body.clientUrl === 'string' && reqOrUrl.body.clientUrl.trim()) {
      return reqOrUrl.body.clientUrl.trim().replace(/\/$/, '');
    }

    if (typeof reqOrUrl.get === 'function') {
      const originHeader = reqOrUrl.get('origin');
      if (originHeader && originHeader !== 'null') {
        return originHeader.replace(/\/$/, '');
      }

      const refererHeader = reqOrUrl.get('referer') || reqOrUrl.get('referrer');
      if (refererHeader) {
        try {
          const parsed = new URL(refererHeader);
          return parsed.origin.replace(/\/$/, '');
        } catch (e) {
          // invalid referer URL format
        }
      }
    }
  }

  if (process.env.CLIENT_URL) {
    return process.env.CLIENT_URL.replace(/\/$/, '');
  }
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.replace(/\/$/, '');
  }

  return process.env.NODE_ENV === 'production' 
    ? 'https://cloudbox-cloud-storage.ayanmanna858.workers.dev' 
    : 'http://localhost:5173';
};

const getSender = () => {
  if (process.env.EMAIL_FROM) {
    return process.env.EMAIL_FROM;
  }
  const userEmail = process.env.EMAIL_USER || EMAIL_USER_FALLBACK;
  return `"CloudBox" <${userEmail}>`;
};

// Reuse a single transporter for email
let transporter;

const createTransporter = async () => {
  if (transporter) return transporter;

  const port = parseInt(process.env.EMAIL_PORT || "465", 10);
  const secure = process.env.EMAIL_SECURE !== undefined 
    ? process.env.EMAIL_SECURE === 'true' 
    : port === 465;

  const rawPass = process.env.EMAIL_PASS || EMAIL_PASS_FALLBACK;
  const cleanPass = rawPass.replace(/\s+/g, '');
  const user = process.env.EMAIL_USER || EMAIL_USER_FALLBACK;

  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port,
    secure, 
    auth: {
      user,
      pass: cleanPass,
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  return transporter;
};

const sendVerificationEmail = async (email, verificationToken, reqOrUrl) => {
  try {
    const frontendUrl = getFrontendUrl(reqOrUrl);
    const vercelEmailUrl = process.env.EMAIL_API_URL || 'https://cloud-based-media-files-storage-bac.vercel.app';
    if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
      try {
        const resp = await fetch(`${vercelEmailUrl}/api/email/verification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, verificationToken, frontendUrl })
        });
        if (resp.ok) {
          console.log("Verification email dispatched via Vercel Email API to:", email);
          return;
        }
      } catch (e) {
        console.warn("Vercel Email API fetch failed, falling back to direct Nodemailer:", e.message);
      }
    }

    const mailTransporter = await createTransporter();
    
    const verifyUrl = `${frontendUrl}/verify?token=${verificationToken}`;

    const mailOptions = {
      from: getSender(), // sender address
      to: email, // list of receivers
      subject: "Verify your Email - CloudBox", // Subject line
      text: `Welcome to CloudBox! Please verify your email by clicking on the following link: ${verifyUrl}`, // plain text body
      headers: {
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
        'Importance': 'Normal'
      },
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; margin: 0; padding: 40px 0; width: 100%;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); overflow: hidden;">
            <div style="background-color: #4F46E5; color: #ffffff; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 600; letter-spacing: 1px;">CloudBox</h1>
            </div>
            <div style="padding: 40px 30px; color: #333333; line-height: 1.6; font-size: 16px;">
              <h2 style="margin-top: 0; color: #1f2937; font-size: 22px;">Welcome to CloudBox!</h2>
              <p style="margin-bottom: 24px;">Thank you for signing up. To complete your registration and secure your account, please verify your email address by clicking the button below.</p>
              
              <div style="text-align: center; margin: 36px 0;">
                <a href="${verifyUrl}" style="display: inline-block; background-color: #4F46E5; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;" target="_blank">Verify Email Address</a>
              </div>
              
              <p style="margin-bottom: 8px; font-size: 14px; color: #6b7280;">If you're having trouble clicking the button, copy and paste the URL below into your web browser:</p>
              <p style="word-break: break-all; color: #4F46E5; font-size: 14px; margin-top: 0;">${verifyUrl}</p>
              
              <p style="margin-top: 32px; font-size: 14px; color: #6b7280;">If you did not request this email, please safely ignore it.</p>
            </div>
            <div style="background-color: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb;">
              &copy; ${new Date().getFullYear()} CloudBox. All rights reserved.
            </div>
          </div>
        </div>
      `, // html body
    };

    const info = await mailTransporter.sendMail(mailOptions);

    console.log("Verification email sent: %s", info.messageId);
  } catch (err) {
    console.error("Failed to send verification email to %s:", email, err);
    transporter = null;
  }
};

const sendPasswordResetEmail = async (email, resetToken, reqOrUrl) => {
  try {
    const frontendUrl = getFrontendUrl(reqOrUrl);
    const vercelEmailUrl = process.env.EMAIL_API_URL || 'https://cloud-based-media-files-storage-bac.vercel.app';
    if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
      try {
        const resp = await fetch(`${vercelEmailUrl}/api/email/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, resetToken, frontendUrl })
        });
        if (resp.ok) {
          console.log("Password reset email dispatched via Vercel Email API to:", email);
          return;
        }
      } catch (e) {
        console.warn("Vercel Email API fetch failed, falling back to direct Nodemailer:", e.message);
      }
    }

    const mailTransporter = await createTransporter();
    
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: getSender(),
      to: email,
      subject: "Password Reset Request - CloudBox",
      text: `You requested a password reset. Click the link to reset your password: ${resetUrl}`,
      headers: {
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
        'Importance': 'Normal'
      },
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; margin: 0; padding: 40px 0; width: 100%;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); overflow: hidden;">
            <div style="background-color: #4F46E5; color: #ffffff; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 600; letter-spacing: 1px;">CloudBox</h1>
            </div>
            <div style="padding: 40px 30px; color: #333333; line-height: 1.6; font-size: 16px;">
              <h2 style="margin-top: 0; color: #1f2937; font-size: 22px;">Password Reset Request</h2>
              <p style="margin-bottom: 24px;">We received a request to reset the password for your CloudBox account. Click the button below to set a new password.</p>
              
              <div style="text-align: center; margin: 36px 0;">
                <a href="${resetUrl}" style="display: inline-block; background-color: #4F46E5; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;" target="_blank">Reset Password</a>
              </div>
              
              <p style="margin-bottom: 8px; font-size: 14px; color: #6b7280;">If you're having trouble clicking the button, copy and paste the URL below into your web browser:</p>
              <p style="word-break: break-all; color: #4F46E5; font-size: 14px; margin-top: 0;">${resetUrl}</p>
              
              <p style="margin-top: 32px; font-size: 14px; color: #6b7280;">If you did not request a password reset, please safely ignore this email. This link will expire in 1 hour.</p>
            </div>
            <div style="background-color: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb;">
              &copy; ${new Date().getFullYear()} CloudBox. All rights reserved.
            </div>
          </div>
        </div>
      `,
    };

    const info = await mailTransporter.sendMail(mailOptions);
    console.log("Password reset email sent: %s", info.messageId);
  } catch (err) {
    console.error("Failed to send password reset email to %s:", email, err);
    transporter = null;
  }
};

const sendShareEmail = async (email, sharerName, resourceName, role, message, reqOrUrl) => {
  try {
    const frontendUrl = getFrontendUrl(reqOrUrl);
    const vercelEmailUrl = process.env.EMAIL_API_URL || 'https://cloud-based-media-files-storage-bac.vercel.app';
    if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
      try {
        const resp = await fetch(`${vercelEmailUrl}/api/email/share`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, sharerName, resourceName, role, message, frontendUrl })
        });
        if (resp.ok) {
          console.log("Share email dispatched via Vercel Email API to:", email);
          return;
        }
      } catch (e) {
        console.warn("Vercel Email API fetch failed, falling back to direct Nodemailer:", e.message);
      }
    }

    const mailTransporter = await createTransporter();
    
    const dashboardUrl = `${frontendUrl}/dashboard`;

    const mailOptions = {
      from: getSender(),
      to: email,
      subject: `${sharerName} shared "${resourceName}" with you - CloudBox`,
      text: `${sharerName} has shared a file/folder with you on CloudBox.\n\n${message ? `Message: "${message}"\n\n` : ''}Role: ${role}\n\nView it here: ${dashboardUrl}`,
      headers: {
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
        'Importance': 'Normal'
      },
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; margin: 0; padding: 40px 0; width: 100%;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); overflow: hidden;">
            <div style="background-color: #4F46E5; color: #ffffff; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 600; letter-spacing: 1px;">CloudBox</h1>
            </div>
            <div style="padding: 40px 30px; color: #333333; line-height: 1.6; font-size: 16px;">
              <h2 style="margin-top: 0; color: #1f2937; font-size: 22px;">${sharerName} shared an item with you</h2>
              <p style="margin-bottom: 24px;"><strong>${sharerName}</strong> has given you access to <strong>${resourceName}</strong> as a <strong>${role}</strong>.</p>
              
              ${message ? `<div style="background-color: #f3f4f6; border-left: 4px solid #4F46E5; padding: 16px; margin-bottom: 24px; color: #4b5563; font-style: italic;">"${message}"</div>` : ''}
              
              <div style="text-align: center; margin: 36px 0;">
                <a href="${dashboardUrl}" style="display: inline-block; background-color: #4F46E5; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;" target="_blank">Open in CloudBox</a>
              </div>
              
              <p style="margin-top: 32px; font-size: 14px; color: #6b7280;">If you are unsure why you received this email, you can safely ignore it.</p>
            </div>
            <div style="background-color: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb;">
              &copy; ${new Date().getFullYear()} CloudBox. All rights reserved.
            </div>
          </div>
        </div>
      `,
    };

    const info = await mailTransporter.sendMail(mailOptions);
    console.log("Share notification email sent successfully to %s: %s", email, info.messageId);
  } catch (err) {
    console.error("Failed to send share email to %s:", email, err);
    transporter = null;
  }
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendShareEmail };
