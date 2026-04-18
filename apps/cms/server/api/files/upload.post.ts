import crypto from 'node:crypto';
import {
  IMAGE_UPLOAD_MAX_SIZE,
  ALLOWED_MIME_TYPES,
  processOriginal,
} from '../../utils/imageProcessing';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

const MAGIC_BYTES: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF
  'image/gif': [0x47, 0x49, 0x46], // GIF
};

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'files.upload');

  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({
      statusCode: 400,
      message: 'Missing multipart form data',
    });
  }

  const filePart = formData.find((part) => part.name === 'file');
  if (!filePart || !filePart.data || !filePart.type) {
    throw createError({ statusCode: 400, message: 'Missing file in upload' });
  }

  if (!ALLOWED_MIME_TYPES.has(filePart.type)) {
    throw createError({
      statusCode: 415,
      message: `Unsupported media type: ${filePart.type}`,
    });
  }

  const expected = MAGIC_BYTES[filePart.type];
  if (expected) {
    const header = filePart.data.slice(0, expected.length);
    if (!expected.every((byte, i) => header[i] === byte)) {
      throw createError({
        statusCode: 415,
        message: 'File content does not match declared type',
      });
    }
  }

  if (filePart.data.length > IMAGE_UPLOAD_MAX_SIZE) {
    throw createError({
      statusCode: 413,
      message: `File too large. Maximum size is ${IMAGE_UPLOAD_MAX_SIZE / 1024 / 1024}MB`,
    });
  }

  const processed = await processOriginal(Buffer.from(filePart.data));
  const storageKey = `${crypto.randomUUID()}.${processed.format}`;

  const storage = useStorage('images:originals');
  await storage.setItemRaw(storageKey, processed.data);

  setResponseStatus(event, 201);
  return {
    storageKey,
    mimeType: `image/${processed.format}`,
    width: processed.width,
    height: processed.height,
    fileSize: processed.data.length,
    originalName: filePart.filename ?? null,
  };
});
