import type { ContentStatusEnumRef } from './contentStatus';

export const contentMetadataFields = (
  t: any,
  ContentStatusEnum: ContentStatusEnumRef
) => ({
  entryTitle: t.exposeString('entryTitle'),
  status: t.expose('status', { type: ContentStatusEnum }),
  publishedAt: t.expose('publishedAt', { type: 'DateTime', nullable: true }),
  createdBy: t.exposeString('createdBy', { nullable: true }),
  updatedBy: t.exposeString('updatedBy', { nullable: true }),
});
