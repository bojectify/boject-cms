import { describe, it, expect } from 'vitest';
import { generateWebhookSecret } from './webhooks';

describe('generateWebhookSecret', () => {
  it('produces a base64 string of at least 32 bytes of entropy', () => {
    const secret = generateWebhookSecret();
    const raw = Buffer.from(secret, 'base64');
    expect(raw.byteLength).toBeGreaterThanOrEqual(32);
  });

  it('returns a different value each call', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});
