export const applyContentMetadata = (
  body: Record<string, unknown>,
  data: Record<string, unknown>,
  currentPublishedAt?: Date | null
) => {
  if ('entryTitle' in body) data.entryTitle = body.entryTitle;
  if ('slug' in body) data.slug = body.slug;
  if ('status' in body) {
    data.status = body.status;
    if (body.status === 'PUBLISHED' && !currentPublishedAt) {
      data.publishedAt = new Date();
    }
  }
};
