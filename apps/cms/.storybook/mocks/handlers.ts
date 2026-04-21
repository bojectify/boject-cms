import { http, HttpResponse } from 'msw';

export const defaultHandlers = [
  http.get('/api/content-types/options', () =>
    HttpResponse.json([
      { label: 'Author', value: 'ct-author' },
      { label: 'Article', value: 'ct-article' },
    ])
  ),
  http.get('/api/content-types/:id', ({ params }) =>
    HttpResponse.json({
      id: params.id,
      fields: [{ identifier: 'title', type: 'ENTRY_TITLE' }],
    })
  ),
  http.get('/api/content-entries', ({ request }) => {
    const url = new URL(request.url);
    const ctId = url.searchParams.get('contentTypeId');
    return HttpResponse.json({
      items:
        ctId === 'ct-author'
          ? [
              { id: 'a1', data: { title: 'Ada Lovelace' } },
              { id: 'a2', data: { title: 'Grace Hopper' } },
            ]
          : [],
      total: ctId === 'ct-author' ? 2 : 0,
    });
  }),
];
