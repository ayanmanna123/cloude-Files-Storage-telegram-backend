/**
 * Upload a file buffer to Telegram storage channel/chat
 * @param {Buffer} buffer 
 * @param {string} fileName 
 * @param {string} mimeType 
 * @returns {Promise<{fileId: string, messageId: number, fileSize: number}>}
 */
async function uploadToTelegram(buffer, fileName, mimeType) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables must be configured.');
  }

  const formData = new FormData();
  formData.append('chat_id', TELEGRAM_CHAT_ID);
  
  const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
  formData.append('document', blob, fileName || 'file');

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();
  console.log('Telegram sendDocument response:', JSON.stringify(data, null, 2));

  if (!data.ok || !data.result) {
    console.error('Telegram upload error response:', data);
    throw new Error(data.description || 'Failed to upload file to Telegram');
  }

  const result = data.result;
  let doc = result.document || (result.photo ? result.photo[result.photo.length - 1] : null);

  if (!doc || !doc.file_id) {
    for (const key of Object.keys(result)) {
      const val = result[key];
      if (Array.isArray(val) && val.length > 0 && val[val.length - 1]?.file_id) {
        doc = val[val.length - 1];
        break;
      } else if (val && typeof val === 'object' && val.file_id) {
        doc = val;
        break;
      }
    }
  }

  if (!doc || !doc.file_id) {
    console.error('Unexpected Telegram result structure:', result);
    throw new Error('Telegram response did not return a valid file_id');
  }

  return {
    fileId: doc.file_id,
    messageId: result.message_id,
    fileSize: doc.file_size || buffer.length,
  };
}

/**
 * Get Telegram download stream for a file_id
 * @param {string} fileId 
 * @returns {Promise<{response: Response, filePath: string, fileSize?: number}>}
 */
async function getTelegramFileStream(fileId) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is missing.');
  }

  // 1. Get file path from Telegram API
  const fileInfoRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const fileInfoData = await fileInfoRes.json();

  if (!fileInfoData.ok || !fileInfoData.result || !fileInfoData.result.file_path) {
    console.error('Telegram getFile error:', fileInfoData);
    throw new Error(fileInfoData.description || 'Failed to retrieve file location from Telegram');
  }

  const filePath = fileInfoData.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

  // 2. Fetch binary stream
  const downloadRes = await fetch(downloadUrl);

  if (!downloadRes.ok) {
    throw new Error(`Failed to fetch file payload from Telegram: ${downloadRes.statusText}`);
  }

  return {
    response: downloadRes,
    filePath: filePath,
    fileSize: fileInfoData.result.file_size,
  };
}

/**
 * Delete a message containing a file from Telegram storage channel/chat
 * @param {number} messageId 
 * @returns {Promise<boolean>}
 */
async function deleteFromTelegram(messageId) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !messageId) {
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        message_id: Number(messageId),
      }),
    });

    const data = await response.json();
    return data.ok === true;
  } catch (err) {
    console.error(`Failed to delete message ${messageId} from Telegram:`, err.message || err);
    return false;
  }
}

module.exports = {
  uploadToTelegram,
  getTelegramFileStream,
  deleteFromTelegram,
};
