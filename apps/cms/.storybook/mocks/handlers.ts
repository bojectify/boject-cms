import { http, HttpResponse } from 'msw';
import { FIELD_TYPES } from '~/utils/fieldTypes';

const contentTypeNames: Record<string, string> = {
  'ct-author': 'Author',
  'ct-article': 'Article',
};

const entries: Record<
  string,
  { id: string; contentTypeId: string; data: Record<string, unknown> }
> = {
  a1: {
    id: 'a1',
    contentTypeId: 'ct-author',
    data: { title: 'Ada Lovelace' },
  },
  a2: {
    id: 'a2',
    contentTypeId: 'ct-author',
    data: { title: 'Grace Hopper' },
  },
};

export const defaultHandlers = [
  http.get('/api/content-types/options', () =>
    HttpResponse.json([
      { label: 'Author', value: 'ct-author' },
      { label: 'Article', value: 'ct-article' },
    ])
  ),
  http.get('/api/content-types/:id', ({ params }) => {
    const id = params.id as string;
    return HttpResponse.json({
      id,
      name: contentTypeNames[id] ?? 'Unknown',
      fields: [{ identifier: 'title', type: FIELD_TYPES.ENTRY_TITLE }],
    });
  }),
  http.get('/api/entries', ({ request }) => {
    const url = new URL(request.url);
    const ctId = url.searchParams.get('contentTypeId');
    const items = Object.values(entries).filter(
      (e) => e.contentTypeId === ctId
    );
    return HttpResponse.json({
      items: items.map((e) => ({ id: e.id, data: e.data })),
      total: items.length,
    });
  }),
  http.get('/api/entries/:id', ({ params }) => {
    const entry = entries[params.id as string];
    if (!entry)
      return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    return HttpResponse.json({
      id: entry.id,
      contentTypeId: entry.contentTypeId,
      data: entry.data,
      contentType: {
        id: entry.contentTypeId,
        name: contentTypeNames[entry.contentTypeId] ?? 'Unknown',
        fields: [{ identifier: 'title', type: FIELD_TYPES.ENTRY_TITLE }],
      },
    });
  }),
];
