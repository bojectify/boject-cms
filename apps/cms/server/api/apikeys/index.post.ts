import {
  createError,
  defineEventHandler,
  readBody,
  setResponseStatus,
} from 'h3';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { generateApiKey } from '../../utils/apiKey';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
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
  enforceMutationRateLimit(event, 'apikey-create');

  const raw = await readBody(event);
  const body = parseCreateBody(raw);

  if (
    event.context.authMethod === 'apikey' &&
    body.scopes.includes('apikey:write')
  ) {
    throw createError({
      statusCode: 403,
      data: {
        error: 'APIKEY_WRITE_REQUIRES_SESSION',
        message: 'Minting an apikey:write key requires session auth.',
      },
    });
  }

  const { raw: rawKey, hash, prefix } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: {
      name: body.name,
      keyHash: hash,
      keyPrefix: prefix,
      scopes: body.scopes,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      createdAt: true,
    },
  });

  setResponseStatus(event, 201);
  return {
    id: created.id,
    name: created.name,
    prefix: created.keyPrefix,
    scopes: created.scopes,
    rawKey,
    createdAt: created.createdAt.toISOString(),
  };
});
