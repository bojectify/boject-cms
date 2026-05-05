import { createError, defineEventHandler, readBody } from 'h3';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import {
  API_KEY_SCOPES,
  isApiKeyScope,
  type ApiKeyScope,
} from '../../../utils/apiKeyScopes';

interface CreateBody {
  name: string;
  scopes: ApiKeyScope[];
}

function throwBad(message: string): never {
  throw createError({
    statusCode: 400,
    data: { error: 'BAD_REQUEST', message },
  });
}

function parseCreateBody(body: unknown): CreateBody {
  if (!body || typeof body !== 'object') {
    throwBad('Body must be an object.');
  }
  const { name, scopes } = body as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim().length === 0) {
    throwBad('`name` is required and must be a non-empty string.');
  }
  if ((name as string).length > 80) {
    throwBad('`name` must be 80 characters or fewer.');
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throwBad('`scopes` is required and must be a non-empty array.');
  }
  for (const s of scopes as unknown[]) {
    if (!isApiKeyScope(s)) {
      throw createError({
        statusCode: 400,
        data: {
          error: 'UNKNOWN_SCOPE',
          message: `Unknown scope "${String(s)}".`,
          recognised: [...API_KEY_SCOPES],
        },
      });
    }
  }

  return {
    name: (name as string).trim(),
    scopes: scopes as ApiKeyScope[],
  };
}

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'apikey:write');
  const raw = await readBody(event);
  const _body = parseCreateBody(raw);
  // Happy path + (i) rule + rate limit come in later slices.
  return { ok: true };
});
