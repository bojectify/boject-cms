import { describe, expect, it } from 'vitest';
import { rng } from '../prng.js';
import { generateImage } from './image.js';

describe('generateImage', () => {
  it('returns an object with the ImageFile JSON shape', () => {
    const rand = rng(1);
    const img = generateImage({ rand, index: 0 });
    expect(Object.keys(img).sort()).toEqual(
      [
        'fileSize',
        'focalPointX',
        'focalPointY',
        'height',
        'mimeType',
        'originalName',
        'storageKey',
        'width',
      ].sort()
    );
  });

  it('produces a fixed mimeType and focal point', () => {
    const rand = rng(7);
    const img = generateImage({ rand, index: 3 });
    expect(img.mimeType).toBe('image/jpeg');
    expect(img.focalPointX).toBe(0.5);
    expect(img.focalPointY).toBe(0.5);
  });

  it('storageKey is a UUID-shaped string (8-4-4-4-12 hex)', () => {
    const rand = rng(2);
    const img = generateImage({ rand, index: 0 });
    expect(img.storageKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('width and height fall within 800..3000 (inclusive)', () => {
    const rand = rng(3);
    for (let i = 0; i < 50; i++) {
      const img = generateImage({ rand, index: i });
      expect(img.width).toBeGreaterThanOrEqual(800);
      expect(img.width).toBeLessThanOrEqual(3000);
      expect(img.height).toBeGreaterThanOrEqual(800);
      expect(img.height).toBeLessThanOrEqual(3000);
      expect(Number.isInteger(img.width)).toBe(true);
      expect(Number.isInteger(img.height)).toBe(true);
    }
  });

  it('fileSize equals width * height * 3 (rough JPEG estimate)', () => {
    const rand = rng(4);
    const img = generateImage({ rand, index: 0 });
    expect(img.fileSize).toBe(img.width * img.height * 3);
  });

  it('originalName threads the index', () => {
    const rand = rng(5);
    expect(generateImage({ rand, index: 0 }).originalName).toBe('image-0.jpg');
    expect(generateImage({ rand, index: 42 }).originalName).toBe(
      'image-42.jpg'
    );
  });

  it('is deterministic — same rand + index produces byte-identical output', () => {
    const a = generateImage({ rand: rng(99), index: 7 });
    const b = generateImage({ rand: rng(99), index: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces distinct storageKeys across successive calls on one PRNG stream', () => {
    const rand = rng(11);
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      keys.add(generateImage({ rand, index: i }).storageKey);
    }
    expect(keys.size).toBe(50);
  });
});
