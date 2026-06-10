import type { QueryContentType } from './types';

export const ARTICLE_CT: QueryContentType = {
  id: 'a1',
  identifier: 'Article',
  name: 'Article',
  fields: [
    { identifier: 'summary', name: 'Summary', type: 'TEXT' },
    {
      identifier: 'status',
      name: 'Status',
      type: 'SELECT',
      choices: [
        { label: 'Draft', value: 'Draft' },
        { label: 'Active', value: 'Active' },
        { label: 'Ended', value: 'Ended' },
      ],
    },
    {
      identifier: 'author',
      name: 'Author',
      type: 'RELATION',
      targetContentTypeIds: ['au1'],
    },
    { identifier: 'published', name: 'Published', type: 'DATETIME' },
    { identifier: 'featured', name: 'Featured', type: 'BOOLEAN' },
    { identifier: 'readTime', name: 'Read time', type: 'NUMBER' },
    {
      identifier: 'tags',
      name: 'Tags',
      type: 'MULTIRELATION',
      targetContentTypeIds: ['tag1'],
    },
  ],
};

export const CONTENT_TYPES: QueryContentType[] = [
  ARTICLE_CT,
  { id: 'ar1', identifier: 'Artist', name: 'Artist', fields: [] },
  { id: 'aw1', identifier: 'Artwork', name: 'Artwork', fields: [] },
];
