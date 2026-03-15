import crypto from 'node:crypto';
import {
  IMAGE_UPLOAD_MAX_SIZE,
  ALLOWED_MIME_TYPES,
  processOriginal,
} from '../../utils/imageProcessing';
import { toImageResponse } from '../../utils/imageResponse';

export default defineEventHandler(async (event) => {
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

  // Validate mime type (client-provided header)
  if (!ALLOWED_MIME_TYPES.has(filePart.type)) {
    throw createError({
      statusCode: 415,
      message: `Unsupported media type: ${filePart.type}`,
    });
  }

  // Validate magic bytes to prevent spoofed Content-Type
  const MAGIC_BYTES: Record<string, number[]> = {
    'image/jpeg': [0xff, 0xd8, 0xff],
    'image/png': [0x89, 0x50, 0x4e, 0x47],
    'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF
    'image/gif': [0x47, 0x49, 0x46], // GIF
  };
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

  // Validate file size
  if (filePart.data.length > IMAGE_UPLOAD_MAX_SIZE) {
    throw createError({
      statusCode: 413,
      message: `File too large. Maximum size is ${IMAGE_UPLOAD_MAX_SIZE / 1024 / 1024}MB`,
    });
  }

  // Process original: auto-orient, enforce max dimensions
  const processed = await processOriginal(Buffer.from(filePart.data));

  // Generate storage key
  const storageKey = `${crypto.randomUUID()}.${processed.format}`;

  // Store in unstorage
  const storage = useStorage('images:originals');
  await storage.setItemRaw(storageKey, processed.data);

  // Extract optional form fields
  const altPart = formData.find((part) => part.name === 'alt');
  const alt = altPart?.data ? altPart.data.toString('utf-8') : '';

  const entryTitlePart = formData.find((part) => part.name === 'entryTitle');
  const entryTitle = entryTitlePart?.data
    ? entryTitlePart.data.toString('utf-8')
    : (filePart.filename ?? '');

  const fpxPart = formData.find((part) => part.name === 'focalPointX');
  const fpyPart = formData.find((part) => part.name === 'focalPointY');
  const focalPointX = fpxPart?.data
    ? Number(fpxPart.data.toString('utf-8'))
    : 0.5;
  const focalPointY = fpyPart?.data
    ? Number(fpyPart.data.toString('utf-8'))
    : 0.5;

  // Create database record
  const image = await prisma.image.create({
    data: {
      entryTitle,
      url: `/api/images/${storageKey}/transform`,
      alt,
      width: processed.width,
      height: processed.height,
      storagePath: storageKey,
      mimeType: `image/${processed.format}`,
      fileSize: processed.data.length,
      originalName: filePart.filename ?? null,
      focalPointX,
      focalPointY,
    },
  });

  setResponseStatus(event, 201);
  return toImageResponse(image);
});
