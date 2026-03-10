import crypto from 'node:crypto';
import {
  IMAGE_UPLOAD_MAX_SIZE,
  ALLOWED_MIME_TYPES,
  processOriginal,
} from '../../utils/imageProcessing';

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

  // Validate mime type
  if (!ALLOWED_MIME_TYPES.has(filePart.type)) {
    throw createError({
      statusCode: 415,
      message: `Unsupported media type: ${filePart.type}`,
    });
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
    },
  });

  setResponseStatus(event, 201);
  return image;
});
