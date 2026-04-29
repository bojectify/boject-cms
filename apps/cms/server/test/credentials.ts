export const TEST_USERNAME =
  process.env.INTEGRATION_TEST_USERNAME ?? 'admin@example.com';
export const TEST_PASSWORD =
  process.env.INTEGRATION_TEST_PASSWORD ?? 'password';

// Aliases for clarity in tests where USER_EMAIL / USER_PASSWORD reads better
export const TEST_USER_EMAIL = TEST_USERNAME;
export const TEST_USER_PASSWORD = TEST_PASSWORD;
