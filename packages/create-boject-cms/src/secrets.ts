import { randomBytes } from 'node:crypto';

export function generateSessionPassword(): string {
  return randomBytes(32).toString('base64');
}

export function generateAdminPassword(): string {
  return randomBytes(16).toString('base64');
}
