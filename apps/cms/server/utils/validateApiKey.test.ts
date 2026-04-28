import { describe, it, expect, vi } from 'vitest';
import { resolveApiKey } from './validateApiKey';
import { hashApiKey } from './apiKey';

type FakePrisma = {
  apiKey: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(row: unknown): FakePrisma {
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('resolveApiKey', () => {
  it('returns invalid when header is missing', async () => {
    const prisma = makePrisma(null);
    const result = await resolveApiKey(prisma as never, undefined);
    expect(result).toEqual({
      valid: false,
      message: 'Missing Authorization header',
    });
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it('returns invalid for malformed Bearer header', async () => {
    const prisma = makePrisma(null);
    const result = await resolveApiKey(prisma as never, 'Basic xyz');
    expect(result).toEqual({
      valid: false,
      message: 'Invalid Authorization format',
    });
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it('returns invalid when no key matches the hash', async () => {
    const prisma = makePrisma(null);
    const result = await resolveApiKey(
      prisma as never,
      'Bearer boject_unknown'
    );
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
    });
    const result = await resolveApiKey(
      prisma as never,
      'Bearer boject_test_revoked'
    );
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
    });
    const result = await resolveApiKey(
      prisma as never,
      'Bearer boject_test_active'
    );
    expect(result).toEqual({
      valid: true,
      apiKeyId: 'key-1',
      keyPrefix: 'boject_test',
    });
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });
});
