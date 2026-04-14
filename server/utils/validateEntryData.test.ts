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
