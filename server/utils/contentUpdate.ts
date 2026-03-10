const VALID_STATUSES = new Set(['DRAFT', 'PUBLISHED', 'CHANGED', 'ARCHIVED']);

export const applyContentMetadata = (
  body: Record<string, unknown>,
  data: Record<string, unknown>,
  currentPublishedAt?: Date | null
) => {
  if ('entryTitle' in body) data.entryTitle = body.entryTitle;
  if ('slug' in body) data.slug = body.slug;
  if ('status' in body) {
    if (!VALID_STATUSES.has(body.status as string)) {
      throw createError({ statusCode: 400, message: 'Invalid status value' });
    }
    data.status = body.status;
    if (body.status === 'PUBLISHED' && !currentPublishedAt) {
      data.publishedAt = new Date();
    }
  }
};
