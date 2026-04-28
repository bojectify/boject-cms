const WEAK_PASSWORD_BLOCKLIST = new Set([
  'password',
  'password123',
  'admin',
  'administrator',
  'boject',
  'changeme',
  'qwerty',
  'qwertyuiop',
  'letmein',
  '12345678',
  '123456789',
  '1234567890',
  'iloveyou',
]);

export const MIN_PASSWORD_LENGTH = 12;

export type PasswordRuleId = 'length' | 'blocklist' | 'localPart';

export interface PasswordRule {
  id: PasswordRuleId;
  label: string;
  test: (password: string, ctx: { email: string }) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    test: (pw) => pw.length >= MIN_PASSWORD_LENGTH,
  },
  {
    id: 'blocklist',
    label: 'Not on the common-password blocklist',
    test: (pw) => !WEAK_PASSWORD_BLOCKLIST.has(pw.toLowerCase()),
  },
  {
    id: 'localPart',
    label: 'Different from the local-part of your email',
    test: (pw, { email }) => {
      const local = email.split('@')[0]?.toLowerCase() ?? '';
      return local.length === 0 || pw.toLowerCase() !== local;
    },
  },
];

export interface PasswordValidationResult {
  ok: boolean;
  failures: PasswordRuleId[];
}

export function validatePassword(
  password: string,
  ctx: { email: string }
): PasswordValidationResult {
  const failures = PASSWORD_RULES.filter(
    (rule) => !rule.test(password, ctx)
  ).map((rule) => rule.id);
  return { ok: failures.length === 0, failures };
}
