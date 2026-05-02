import { defineEventHandler, readBody, createError } from 'h3';
import { applySchema } from '../../../scripts/content-bundle/applySchema';
import {
  SchemaApplyValidationError,
  SchemaApplyBlockedError,
  SchemaChangedDuringApplyError,
} from '../../../scripts/content-bundle/applySchemaErrors';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { assertSchemaEditable } from '../../utils/schemaReadOnly';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

interface ApplyRequestBody {
  bundle?: unknown;
  allowDestructive?: boolean;
  dryRun?: boolean;
}

export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  assertApiKeyScope(event, 'schema:write');
  enforceMutationRateLimit(event, 'schema-apply');

  const body = (await readBody<ApplyRequestBody>(event)) ?? {};
  if (!body.bundle || typeof body.bundle !== 'object') {
    throw createError({
      statusCode: 400,
      data: { error: 'BAD_REQUEST', message: 'Body must include `bundle`.' },
    });
  }

  try {
    const result = await applySchema(prisma, body.bundle as never, {
      allowDestructive: body.allowDestructive === true,
      dryRun: body.dryRun === true,
    });
    return result;
  } catch (err) {
    if (err instanceof SchemaApplyValidationError) {
      throw createError({
        statusCode: 400,
        data: { error: err.code, errors: err.errors },
      });
    }
    if (err instanceof SchemaApplyBlockedError) {
      throw createError({
        statusCode: 400,
        data: { error: err.code, blockers: err.blockers, plan: err.plan },
      });
    }
    if (err instanceof SchemaChangedDuringApplyError) {
      throw createError({
        statusCode: 409,
        data: { error: err.code },
      });
    }
    throw err;
  }
});
