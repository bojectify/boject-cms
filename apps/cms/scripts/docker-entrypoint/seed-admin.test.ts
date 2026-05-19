import { describe, expect, it, vi } from 'vitest';
import { seedAdminIfEmpty } from './seed-admin';

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
      // eslint-disable-next-line no-restricted-syntax -- PrismaClient surface is wide; mock only has user.count/user.create
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
      // eslint-disable-next-line no-restricted-syntax -- PrismaClient surface is wide; mock only has user.count/user.create
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
