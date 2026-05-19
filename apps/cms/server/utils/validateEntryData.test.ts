import { describe, expect, it } from 'vitest';
import { validateEntryData } from './validateEntryData';
import { FIELD_TYPES } from '../../utils/fieldTypes';

const imageField = {
  identifier: 'hero',
  name: 'Hero',
  type: FIELD_TYPES.IMAGE,
  required: true,
  options: null,
};

const fullImage = {
  storageKey: 'abc123.webp',
  mimeType: 'image/webp',
  width: 1600,
  height: 900,
  fileSize: 123456,
  originalName: 'sunset.jpg',
  focalPointX: 0.3,
  focalPointY: 0.7,
};

const richtextFieldNoEmbeds = {
  identifier: 'body',
  name: 'Body',
  type: FIELD_TYPES.RICHTEXT,
  required: false,
  options: null,
};

const ALLOWED_CT_UUID = '11111111-1111-4111-8111-111111111111';
const DISALLOWED_CT_UUID = '22222222-2222-4222-8222-222222222222';
const ANY_CT_UUID = '33333333-3333-4333-8333-333333333333';

const richtextFieldWithAllowList = {
  identifier: 'body',
  name: 'Body',
  type: FIELD_TYPES.RICHTEXT,
  required: false,
  options: { targetContentTypeIds: [ALLOWED_CT_UUID] },
};

const doc = (content: unknown[]) => ({ type: 'doc', content });
const para = (content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string) => ({ type: 'text', text: value });
const embed = (contentTypeId: string, entryId: string) => ({
  type: 'cmsEmbed',
  attrs: { contentTypeId, entryId },
});

describe('validateEntryData — RICHTEXT embeds (cmsEmbed nodes)', () => {
  it('accepts a body with no embeds when allow-list is empty', async () => {
    const result = await validateEntryData(
      { body: doc([para([text('hello')])]) },
      [richtextFieldNoEmbeds]
    );
    expect(result.body).toEqual(doc([para([text('hello')])]));
  });

  it('rejects any embed when allow-list is empty', async () => {
    await expect(
      validateEntryData(
        {
          body: doc([para([text('hello '), embed('any-ct', 'any-entry')])]),
        },
        [richtextFieldNoEmbeds]
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('Inline embeds are not allowed'),
    });
  });

  it('accepts embed whose contentTypeId is in the allow-list', async () => {
    const value = doc([
      para([text('see '), embed(ALLOWED_CT_UUID, 'entry-1')]),
    ]);
    const result = await validateEntryData({ body: value }, [
      richtextFieldWithAllowList,
    ]);
    expect(result.body).toEqual(value);
  });

  it('rejects embed whose contentTypeId is not in the allow-list', async () => {
    await expect(
      validateEntryData(
        { body: doc([para([embed(DISALLOWED_CT_UUID, 'entry-1')])]) },
        [richtextFieldWithAllowList]
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('not allowed for this field'),
    });
  });

  it('rejects a malformed embed node (missing attrs)', async () => {
    await expect(
      validateEntryData({ body: doc([para([{ type: 'cmsEmbed' }])]) }, [
        richtextFieldWithAllowList,
      ])
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('Invalid inline embed'),
    });
  });

  it('walks nested content (embed inside blockquote)', async () => {
    await expect(
      validateEntryData(
        {
          body: doc([
            {
              type: 'blockquote',
              content: [para([embed(DISALLOWED_CT_UUID, 'e1')])],
            },
          ]),
        },
        [richtextFieldWithAllowList]
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('walks list items (embed inside a bulletList > listItem > paragraph)', async () => {
    await expect(
      validateEntryData(
        {
          body: doc([
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [para([embed(DISALLOWED_CT_UUID, 'e1')])],
                },
              ],
            },
          ]),
        },
        [richtextFieldWithAllowList]
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('walks table cells (embed inside a table > row > cell)', async () => {
    await expect(
      validateEntryData(
        {
          body: doc([
            {
              type: 'table',
              content: [
                {
                  type: 'tableRow',
                  content: [
                    {
                      type: 'tableCell',
                      content: [para([embed(DISALLOWED_CT_UUID, 'e1')])],
                    },
                  ],
                },
              ],
            },
          ]),
        },
        [richtextFieldWithAllowList]
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects when ANY embed in the document is disallowed (does not short-circuit on first valid embed)', async () => {
    await expect(
      validateEntryData(
        {
          body: doc([
            para([
              embed(ALLOWED_CT_UUID, 'e1'),
              text(' and '),
              embed(DISALLOWED_CT_UUID, 'e2'),
            ]),
          ]),
        },
        [richtextFieldWithAllowList]
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('not allowed for this field'),
    });
  });

  it('rejects an embed with empty-string contentTypeId via the "missing ids" message (not the misleading "not allowed" message)', async () => {
    await expect(
      validateEntryData(
        {
          body: doc([para([embed('', 'entry-1')])]),
        },
        [richtextFieldWithAllowList]
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Invalid inline embed (missing contentTypeId or entryId)'
      ),
    });
  });

  it('rejects an embed with empty-string entryId via the "missing ids" message', async () => {
    await expect(
      validateEntryData(
        {
          body: doc([para([embed(ALLOWED_CT_UUID, '')])]),
        },
        [richtextFieldWithAllowList]
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Invalid inline embed (missing contentTypeId or entryId)'
      ),
    });
  });

  it('surfaces the offending contentTypeId in the "not allowed for this field" error', async () => {
    await expect(
      validateEntryData(
        { body: doc([para([embed(DISALLOWED_CT_UUID, 'entry-1')])]) },
        [richtextFieldWithAllowList]
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        `contentTypeId: ${DISALLOWED_CT_UUID}`
      ),
    });
  });

  it('surfaces the offending contentTypeId in the "embeds are not allowed in this field" error', async () => {
    await expect(
      validateEntryData(
        { body: doc([para([embed(ANY_CT_UUID, 'entry-1')])]) },
        [richtextFieldNoEmbeds]
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(`contentTypeId: ${ANY_CT_UUID}`),
    });
  });
});

describe('validateEntryData — IMAGE', () => {
  it('accepts a valid full IMAGE value', async () => {
    const result = await validateEntryData({ hero: fullImage }, [imageField]);
    expect(result.hero).toEqual(fullImage);
  });

  it('defaults focalPointX/Y to 0.5 when omitted', async () => {
    const { focalPointX, focalPointY, ...rest } = fullImage;
    const result = await validateEntryData({ hero: rest }, [imageField]);
    expect(result.hero).toMatchObject({
      focalPointX: 0.5,
      focalPointY: 0.5,
    });
  });

  it('accepts null originalName', async () => {
    const result = await validateEntryData(
      { hero: { ...fullImage, originalName: null } },
      [imageField]
    );
    expect((result.hero as Record<string, unknown>).originalName).toBeNull();
  });

  it('clamps out-of-range focalPointX to 0.5', async () => {
    const result = await validateEntryData(
      { hero: { ...fullImage, focalPointX: 1.5 } },
      [imageField]
    );
    expect((result.hero as Record<string, unknown>).focalPointX).toBe(0.5);
  });

  it('rejects missing storageKey with 400', async () => {
    const { storageKey: _drop, ...partial } = fullImage;
    await expect(
      validateEntryData({ hero: partial }, [imageField])
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects non-numeric width with 400', async () => {
    await expect(
      validateEntryData({ hero: { ...fullImage, width: 'wide' } }, [imageField])
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects null when required', async () => {
    await expect(
      validateEntryData({ hero: null }, [imageField])
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('allows null when optional', async () => {
    const result = await validateEntryData({ hero: null }, [
      { ...imageField, required: false },
    ]);
    expect(result.hero).toBeNull();
  });

  it('drops unknown keys from the input object', async () => {
    const result = await validateEntryData(
      { hero: { ...fullImage, junk: 'ignored' } },
      [imageField]
    );
    expect(result.hero).not.toHaveProperty('junk');
  });
});

describe('validateEntryData — RICHTEXT entry links (cmsLink nodes)', () => {
  const CT_PAGE_UUID = '44444444-4444-4444-8444-444444444444';
  const CT_OTHER_UUID = '55555555-5555-4555-8555-555555555555';

  const fields = (
    allowedLinks: string[]
  ): Parameters<typeof validateEntryData>[1] => [
    {
      identifier: 'body',
      name: 'Body',
      type: FIELD_TYPES.RICHTEXT,
      required: false,
      options: { linkTargetContentTypeIds: allowedLinks },
    },
  ];

  const docWithLink = (contentTypeId: string, entryId: string) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'before ' },
          {
            type: 'cmsLink',
            attrs: { contentTypeId, entryId },
          },
          { type: 'text', text: ' after' },
        ],
      },
    ],
  });

  it('accepts a cmsLink node whose contentTypeId is in linkTargetContentTypeIds', async () => {
    const data = { body: docWithLink(CT_PAGE_UUID, 'e-1') };
    const result = await validateEntryData(data, fields([CT_PAGE_UUID]));
    expect(result.body).toEqual(data.body);
  });

  it('rejects a cmsLink node whose contentTypeId is NOT in linkTargetContentTypeIds', async () => {
    const data = { body: docWithLink(CT_OTHER_UUID, 'e-1') };
    await expect(
      validateEntryData(data, fields([CT_PAGE_UUID]))
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: Entry link references a content type that is not allowed'
      ),
    });
  });

  it('rejects any cmsLink node when linkTargetContentTypeIds is empty', async () => {
    const data = { body: docWithLink(CT_PAGE_UUID, 'e-1') };
    await expect(validateEntryData(data, fields([]))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: Entry links are not allowed in this field'
      ),
    });
  });

  it('rejects a cmsLink node missing required ids', async () => {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'cmsLink', attrs: { contentTypeId: CT_PAGE_UUID } },
            ],
          },
        ],
      },
    };
    await expect(
      validateEntryData(data, fields([CT_PAGE_UUID]))
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: Invalid entry link (missing contentTypeId or entryId)'
      ),
    });
  });

  it('does not reject external link marks when no link allow-list is set', async () => {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [{ type: 'link', attrs: { href: 'https://x.test' } }],
              },
            ],
          },
        ],
      },
    };
    const result = await validateEntryData(data, fields([]));
    expect(result.body).toEqual(data.body);
  });

  it('rejects a cmsLink node missing both contentTypeId and entryId', async () => {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'cmsLink', attrs: {} }],
          },
        ],
      },
    };
    await expect(
      validateEntryData(data, fields([CT_PAGE_UUID]))
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: Invalid entry link (missing contentTypeId or entryId)'
      ),
    });
  });

  it('rejects a cmsLink node with no attrs key at all', async () => {
    const data = {
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'cmsLink' }] }],
      },
    };
    await expect(
      validateEntryData(data, fields([CT_PAGE_UUID]))
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: Invalid entry link (missing contentTypeId or entryId)'
      ),
    });
  });

  it('rejects a cmsLink with empty-string contentTypeId via the "missing ids" message', async () => {
    const data = { body: docWithLink('', 'e-1') };
    await expect(
      validateEntryData(data, fields([CT_PAGE_UUID]))
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: Invalid entry link (missing contentTypeId or entryId)'
      ),
    });
  });

  it('rejects a cmsLink with empty-string entryId via the "missing ids" message', async () => {
    const data = { body: docWithLink(CT_PAGE_UUID, '') };
    await expect(
      validateEntryData(data, fields([CT_PAGE_UUID]))
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: Invalid entry link (missing contentTypeId or entryId)'
      ),
    });
  });

  it('surfaces the offending contentTypeId in the "not allowed for this field" error', async () => {
    const data = { body: docWithLink(CT_OTHER_UUID, 'e-1') };
    await expect(
      validateEntryData(data, fields([CT_PAGE_UUID]))
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(`contentTypeId: ${CT_OTHER_UUID}`),
    });
  });

  it('surfaces the offending contentTypeId in the "links are not allowed in this field" error', async () => {
    const data = { body: docWithLink(CT_PAGE_UUID, 'e-1') };
    await expect(validateEntryData(data, fields([]))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(`contentTypeId: ${CT_PAGE_UUID}`),
    });
  });
});

describe('validateEntryData — RICHTEXT external links (externalLink nodes)', () => {
  const fields = (): Parameters<typeof validateEntryData>[1] => [
    {
      identifier: 'body',
      name: 'Body',
      type: FIELD_TYPES.RICHTEXT,
      required: false,
      options: null,
    },
  ];

  const docWithExternalLink = (attrs: Record<string, unknown>) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'see ' },
          { type: 'externalLink', attrs },
          { type: 'text', text: ' for details' },
        ],
      },
    ],
  });

  it('accepts an externalLink with a valid https href', async () => {
    const data = { body: docWithExternalLink({ href: 'https://example.com' }) };
    const result = await validateEntryData(data, fields());
    expect(result.body).toEqual(data.body);
  });

  it('accepts http, mailto and tel schemes', async () => {
    for (const href of [
      'http://example.com',
      'mailto:hello@example.com',
      'tel:+441234567890',
      'tel:+6494461709',
    ]) {
      const data = { body: docWithExternalLink({ href }) };
      const result = await validateEntryData(data, fields());
      expect(result.body).toEqual(data.body);
    }
  });

  it('rejects an externalLink with missing href', async () => {
    const data = { body: docWithExternalLink({}) };
    await expect(validateEntryData(data, fields())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: External link is missing href'
      ),
    });
  });

  it('rejects an externalLink with empty-string href', async () => {
    const data = { body: docWithExternalLink({ href: '' }) };
    await expect(validateEntryData(data, fields())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: External link is missing href'
      ),
    });
  });

  it('rejects an externalLink with invalid URL', async () => {
    const data = { body: docWithExternalLink({ href: 'not a url' }) };
    await expect(validateEntryData(data, fields())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: External link href is not a valid URL'
      ),
    });
  });

  it('rejects an externalLink with javascript: scheme', async () => {
    const data = {
      body: docWithExternalLink({ href: 'javascript:alert(1)' }),
    };
    await expect(validateEntryData(data, fields())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        "External link scheme 'javascript:' is not allowed"
      ),
    });
  });

  it('rejects an externalLink with file: scheme', async () => {
    const data = {
      body: docWithExternalLink({ href: 'file:///etc/passwd' }),
    };
    await expect(validateEntryData(data, fields())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        "External link scheme 'file:' is not allowed"
      ),
    });
  });

  it('rejects an externalLink with empty mailto: payload', async () => {
    const data = { body: docWithExternalLink({ href: 'mailto:' }) };
    await expect(validateEntryData(data, fields())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'External link mailto target is missing'
      ),
    });
  });

  it('rejects an externalLink with empty tel: payload', async () => {
    const data = { body: docWithExternalLink({ href: 'tel:' }) };
    await expect(validateEntryData(data, fields())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'External link tel target is missing'
      ),
    });
  });

  it('rejects an externalLink with embedded credentials', async () => {
    const data = {
      body: docWithExternalLink({ href: 'https://user:pass@example.com' }),
    };
    await expect(validateEntryData(data, fields())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('must not embed credentials'),
    });
  });

  it('rejects an externalLink with username only', async () => {
    const data = {
      body: docWithExternalLink({ href: 'https://user@example.com' }),
    };
    await expect(validateEntryData(data, fields())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('must not embed credentials'),
    });
  });

  it('rejects a protocol-relative URL (regression — no base means parse fails)', async () => {
    const data = { body: docWithExternalLink({ href: '//example.com' }) };
    await expect(validateEntryData(data, fields())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'External link href is not a valid URL'
      ),
    });
  });

  it('rejects an externalLink with whitespace-only href', async () => {
    const data = { body: docWithExternalLink({ href: '   ' }) };
    await expect(validateEntryData(data, fields())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining('External link is missing href'),
    });
  });
});
