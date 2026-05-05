import { defineEventHandler } from 'h3';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'apikey:write');
  // Body validation, (i) rule, key creation come in later slices.
  return { ok: true };
});
