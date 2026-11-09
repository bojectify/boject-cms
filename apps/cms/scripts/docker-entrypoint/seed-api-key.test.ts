import { describe, expect, it, vi } from 'vitest';
import {
  parseBootstrapApiKey,
  parseBootstrapScopes,
  seedBootstrapApiKey,
} from './seed-api-key';

const HASH = '0'.repeat(64);
const VALUE = `boject_ab12:${HASH}`;

describe('parseBootstrapApiKey', () => {
  it('splits a valid value into prefix and hash', () => {
    expect(parseBootstrapApiKey(VALUE)).toStrictEqual({
      prefix: 'boject_ab12',
      hash: HASH,
    });
  });

  it.each([
    ['a trailing CR', `${VALUE}\r`],
    ['surrounding spaces', `  ${VALUE}  `],
  ])('tolerates %s', (_label, value) => {
    expect(parseBootstrapApiKey(value)).toStrictEqual({
      prefix: 'boject_ab12',
      hash: HASH,
    });
  });

  it.each([
    ['empty', ''],
    ['no hash', 'boject_ab12'],
    ['a short hash', `boject_ab12:${'0'.repeat(63)}`],
    ['an uppercase hash', `boject_ab12:${'A'.repeat(64)}`],
    ['a non-hex prefix', `boject_xyz1:${HASH}`],
    ['no boject_ prefix', `nothex:${HASH}`],
  ])('rejects %s, naming the variable', (_label, value) => {
    expect(() => parseBootstrapApiKey(value)).toThrow(
      /BOJECT_BOOTSTRAP_API_KEY/
    );
  });
});

describe('parseBootstrapScopes', () => {
  it('parses a comma-separated list', () => {
    expect(parseBootstrapScopes('schema:read,schema:write')).toStrictEqual([
      'schema:read',
      'schema:write',
    ]);
  });

  it('trims items and drops empty ones', () => {
    expect(
      parseBootstrapScopes(' schema:read , schema:write ,\r')
    ).toStrictEqual(['schema:read', 'schema:write']);
  });

  it('rejects an unknown scope, naming it', () => {
    expect(() => parseBootstrapScopes('schema:read,nope:write')).toThrow(
      /nope:write/
    );
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['only separators', ' , '],
  ])('rejects %s scopes (never grants implicitly)', (_label, value) => {
    expect(() => parseBootstrapScopes(value)).toThrow(
      /BOJECT_BOOTSTRAP_API_KEY_SCOPES/
    );
  });
});

type MockPrisma = {
  apiKey: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(existing: unknown): MockPrisma {
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue({ id: 'k_1' }),
    },
  };
}

const input = {
  prefix: 'boject_ab12',
  hash: HASH,
  scopes: ['schema:read', 'apikey:write'] as const,
};

function seed(prisma: MockPrisma) {
  return seedBootstrapApiKey(
    // eslint-disable-next-line no-restricted-syntax -- PrismaClient surface is wide; mock only has apiKey.findUnique/create
    prisma as unknown as Parameters<typeof seedBootstrapApiKey>[0],
    { ...input, scopes: [...input.scopes] }
  );
}

describe('seedBootstrapApiKey', () => {
  it('creates the key when no row has that hash', async () => {
    const prisma = makePrisma(null);
    expect(await seed(prisma)).toStrictEqual({
      seeded: true,
      reason: 'created',
    });
    expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: HASH },
    });
    expect(prisma.apiKey.create).toHaveBeenCalledOnce();
    expect(prisma.apiKey.create).toHaveBeenCalledWith({
      data: {
        name: 'cli (bootstrap)',
        keyHash: HASH,
        keyPrefix: 'boject_ab12',
        scopes: ['schema:read', 'apikey:write'],
      },
    });
  });

  it('is a no-op when the key already exists', async () => {
    const prisma = makePrisma({ id: 'k_1', revokedAt: null });
    expect(await seed(prisma)).toStrictEqual({
      seeded: false,
      reason: 'already-exists',
    });
    expect(prisma.apiKey.create).not.toHaveBeenCalled();
  });

  it('never recreates a revoked bootstrap key', async () => {
    const prisma = makePrisma({ id: 'k_1', revokedAt: new Date() });
    expect(await seed(prisma)).toStrictEqual({
      seeded: false,
      reason: 'already-exists',
    });
    expect(prisma.apiKey.create).not.toHaveBeenCalled();
  });
});
