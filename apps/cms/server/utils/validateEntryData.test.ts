import { describe, expect, it } from 'vitest';
import { validateEntryData } from './validateEntryData';

const imageField = {
  identifier: 'hero',
  name: 'Hero',
  type: 'IMAGE' as const,
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
  type: 'RICHTEXT' as const,
  required: false,
  options: null,
};

const richtextFieldWithAllowList = {
  identifier: 'body',
  name: 'Body',
  type: 'RICHTEXT' as const,
  required: false,
  options: { targetContentTypeIds: ['allowed-ct-uuid'] },
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
      para([text('see '), embed('allowed-ct-uuid', 'entry-1')]),
    ]);
    const result = await validateEntryData({ body: value }, [
      richtextFieldWithAllowList,
    ]);
    expect(result.body).toEqual(value);
  });

  it('rejects embed whose contentTypeId is not in the allow-list', async () => {
    await expect(
      validateEntryData(
        { body: doc([para([embed('disallowed-ct', 'entry-1')])]) },
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
              content: [para([embed('disallowed-ct', 'e1')])],
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
                  content: [para([embed('disallowed-ct', 'e1')])],
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
                      content: [para([embed('disallowed-ct', 'e1')])],
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
              embed('allowed-ct-uuid', 'e1'),
              text(' and '),
              embed('disallowed-ct', 'e2'),
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
  const fields = (
    allowedLinks: string[]
  ): Parameters<typeof validateEntryData>[1] => [
    {
      identifier: 'body',
      name: 'Body',
      type: 'RICHTEXT',
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
    const data = { body: docWithLink('ct-page', 'e-1') };
    const result = await validateEntryData(data, fields(['ct-page']));
    expect(result.body).toEqual(data.body);
  });

  it('rejects a cmsLink node whose contentTypeId is NOT in linkTargetContentTypeIds', async () => {
    const data = { body: docWithLink('ct-other', 'e-1') };
    await expect(
      validateEntryData(data, fields(['ct-page']))
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: Entry link references a content type that is not allowed'
      ),
    });
  });

  it('rejects any cmsLink node when linkTargetContentTypeIds is empty', async () => {
    const data = { body: docWithLink('ct-page', 'e-1') };
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
            content: [{ type: 'cmsLink', attrs: { contentTypeId: 'ct-page' } }],
          },
        ],
      },
    };
    await expect(
      validateEntryData(data, fields(['ct-page']))
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
      validateEntryData(data, fields(['ct-page']))
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringContaining(
        'Body: Invalid entry link (missing contentTypeId or entryId)'
      ),
    });
  });
});

describe('validateEntryData — RICHTEXT external links (externalLink nodes)', () => {
  const fields = (): Parameters<typeof validateEntryData>[1] => [
    {
      identifier: 'body',
      name: 'Body',
      type: 'RICHTEXT',
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
