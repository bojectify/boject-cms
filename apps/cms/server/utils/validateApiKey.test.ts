import { describe, it, expect, vi } from 'vitest';
import { resolveApiKey } from './validateApiKey';
import type { ApiKeyClient } from './validateApiKey';
import { hashApiKey } from './apiKey';

type ApiKeyRow = {
  id: string;
  keyPrefix: string;
  revokedAt: Date | null;
  scopes: string[];
} | null;

function makePrisma(row: ApiKeyRow): ApiKeyClient {
  return {
    apiKey: {
      findUnique: vi
        .fn()
        .mockResolvedValue(row) as ApiKeyClient['apiKey']['findUnique'],
      update: vi
        .fn()
        .mockResolvedValue(undefined) as ApiKeyClient['apiKey']['update'],
    },
  };
}

describe('resolveApiKey', () => {
  it('returns invalid when header is missing', async () => {
    const prisma = makePrisma(null);
    const result = await resolveApiKey(prisma, undefined);
    expect(result).toEqual({
      valid: false,
      message: 'Missing Authorization header',
    });
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it('returns invalid for malformed Bearer header', async () => {
    const prisma = makePrisma(null);
    const result = await resolveApiKey(prisma, 'Basic xyz');
    expect(result).toEqual({
      valid: false,
      message: 'Invalid Authorization format',
    });
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it('returns invalid when no key matches the hash', async () => {
    const prisma = makePrisma(null);
    const result = await resolveApiKey(prisma, 'Bearer boject_unknown');
    expect(result).toEqual({ valid: false, message: 'Invalid API key' });
    expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: hashApiKey('boject_unknown') },
    });
  });

  it('returns invalid for a revoked key', async () => {
    const prisma = makePrisma({
      id: 'key-1',
      keyPrefix: 'boject_test',
      revokedAt: new Date('2026-04-01'),
      scopes: [],
    });
    const result = await resolveApiKey(prisma, 'Bearer boject_test_revoked');
    expect(result).toEqual({
      valid: false,
      message: 'API key has been revoked',
    });
  });

  it('returns valid with apiKeyId + keyPrefix on success', async () => {
    const prisma = makePrisma({
      id: 'key-1',
      keyPrefix: 'boject_test',
      revokedAt: null,
      scopes: [],
    });
    const result = await resolveApiKey(prisma, 'Bearer boject_test_active');
    expect(result).toEqual({
      valid: true,
      apiKeyId: 'key-1',
      keyPrefix: 'boject_test',
      scopes: [],
    });
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it('propagates non-empty scopes through the success path', async () => {
    const prisma = makePrisma({
      id: 'key-1',
      keyPrefix: 'boject_test',
      revokedAt: null,
      scopes: ['schema:write'],
    });
    const result = await resolveApiKey(prisma, 'Bearer boject_test_active');
    expect(result).toEqual({
      valid: true,
      apiKeyId: 'key-1',
      keyPrefix: 'boject_test',
      scopes: ['schema:write'],
    });
  });

  it('does not throw when the lastUsedAt update rejects', async () => {
    const prisma = makePrisma({
      id: 'key-1',
      keyPrefix: 'boject_test',
      revokedAt: null,
      scopes: [],
    });
    vi.mocked(prisma.apiKey.update).mockRejectedValueOnce(new Error('db down'));
    await expect(
      resolveApiKey(prisma, 'Bearer boject_test_active')
    ).resolves.toMatchObject({ valid: true });
    // Allow the catch to settle so any unhandled-rejection guard sees it
    await new Promise((r) => setImmediate(r));
  });
});
