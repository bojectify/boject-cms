import { describe, expect, it, vi } from 'vitest';
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  seedAdminIfEmpty,
  validateAdminPassword,
} from './seed-admin';

type MockPrisma = {
  user: {
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(count: number): MockPrisma {
  return {
    user: {
      count: vi.fn().mockResolvedValue(count),
      create: vi.fn().mockResolvedValue({ id: 'u_1' }),
    },
  };
}

describe('seedAdminIfEmpty', () => {
  it('seeds when User table is empty', async () => {
    const prisma = makePrisma(0);
    const hashPassword = vi.fn().mockResolvedValue('$scrypt$hashed');

    const result = await seedAdminIfEmpty(
      prisma as unknown as Parameters<typeof seedAdminIfEmpty>[0],
      {
        email: 'a@b.com',
        password: 'plaintext',
        firstName: 'Admin',
        lastName: 'User',
        hashPassword,
      }
    );

    expect(result).toEqual({ seeded: true, reason: 'created' });
    expect(hashPassword).toHaveBeenCalledWith('plaintext');
    expect(prisma.user.create).toHaveBeenCalledOnce();
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'a@b.com',
        password: '$scrypt$hashed',
        firstName: 'Admin',
        lastName: 'User',
      },
    });
  });

  it('is a no-op when User table already has rows', async () => {
    const prisma = makePrisma(5);
    const hashPassword = vi.fn();

    const result = await seedAdminIfEmpty(
      prisma as unknown as Parameters<typeof seedAdminIfEmpty>[0],
      {
        email: 'a@b.com',
        password: 'plaintext',
        firstName: 'Admin',
        lastName: 'User',
        hashPassword,
      }
    );

    expect(result).toEqual({ seeded: false, reason: 'users-already-exist' });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe('validateAdminPassword', () => {
  const email = 'admin@example.com';

  it('accepts a strong password', () => {
    expect(validateAdminPassword('R8#fT2!qwLpZ', email)).toEqual({ ok: true });
  });

  it(`rejects passwords shorter than ${MIN_ADMIN_PASSWORD_LENGTH} chars`, () => {
    const result = validateAdminPassword('short1!', email);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(`${MIN_ADMIN_PASSWORD_LENGTH}`);
    }
  });

  it.each([
    'password',
    'PASSWORD',
    'changeme',
    'admin',
    'qwertyuiop',
    '123456789',
  ])('rejects blocklisted password %s', (pw) => {
    const result = validateAdminPassword(pw, email);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/blocklist/);
    }
  });

  it('rejects passwords matching the email local-part', () => {
    const result = validateAdminPassword(
      'verylongusername',
      'verylongusername@example.com'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/email local-part/);
    }
  });

  it('is case-insensitive against the local-part', () => {
    const result = validateAdminPassword(
      'VeryLongUsername',
      'verylongusername@example.com'
    );
    expect(result.ok).toBe(false);
  });
});
