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

describe('validateEntryData — RICHTEXT embeds', () => {
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
