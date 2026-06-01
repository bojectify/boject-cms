import { defineEventHandler, readBody, createError } from 'h3';
import { importBundle } from '../../../scripts/content-bundle/import';
import {
  BundleImportValidationError,
  EntryImportConflictError,
  EntryImportReferenceError,
} from '../../../scripts/content-bundle/importErrors';
import type { OnConflict } from '../../../scripts/content-bundle/types';
import { ON_CONFLICT_VALUES } from '../../../scripts/content-bundle/types';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

interface ImportRequestBody {
  bundle?: unknown;
  author?: string;
  onConflict?: string;
  dryRun?: boolean;
}

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:import');
  enforceMutationRateLimit(event, 'content-bundle-import');

  const body = (await readBody<ImportRequestBody>(event)) ?? {};
  if (!body.bundle || typeof body.bundle !== 'object') {
    throw createError({
      statusCode: 400,
      data: { error: 'BAD_REQUEST', message: 'Body must include `bundle`.' },
    });
  }

  const onConflict: OnConflict = (
    ON_CONFLICT_VALUES as readonly string[]
  ).includes(body.onConflict ?? 'fail')
    ? (body.onConflict as OnConflict)
    : 'fail';

  try {
    return await importBundle(prisma, body.bundle as never, {
      mode: 'entries',
      author: typeof body.author === 'string' ? body.author : undefined,
      onConflict,
      dryRun: body.dryRun === true,
    });
  } catch (err) {
    if (err instanceof BundleImportValidationError) {
      throw createError({
        statusCode: 400,
        data: { error: err.code, errors: err.errors },
      });
    }
    if (err instanceof EntryImportConflictError) {
      throw createError({
        statusCode: 409,
        data: {
          error: err.code,
          contentTypeIdentifier: err.contentTypeIdentifier,
          entryKey: err.entryKey,
          message: err.message,
        },
      });
    }
    if (err instanceof EntryImportReferenceError) {
      throw createError({
        statusCode: 400,
        data: { error: err.code, message: err.message },
      });
    }
    throw err;
  }
});
