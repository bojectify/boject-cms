import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signPayload } from './signPayload';

describe('signPayload', () => {
  it('produces HMAC-SHA256 of "<timestamp>.<body>" as hex', () => {
    const secret = 'test-secret';
    const body = '{"hello":"world"}';
    const timestamp = 1700000000;
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    expect(signPayload(secret, timestamp, body)).toBe(expected);
  });

  it('is stable across calls with the same inputs', () => {
    const a = signPayload('s', 1, 'b');
    const b = signPayload('s', 1, 'b');
    expect(a).toBe(b);
  });

  it('changes if body changes', () => {
    const a = signPayload('s', 1, 'a');
    const b = signPayload('s', 1, 'b');
    expect(a).not.toBe(b);
  });

  it('changes if timestamp changes', () => {
    const a = signPayload('s', 1, 'body');
    const b = signPayload('s', 2, 'body');
    expect(a).not.toBe(b);
  });
});
