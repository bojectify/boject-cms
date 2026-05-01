import { assertUuid } from '../../../../utils/validation';
import { withPrismaErrors } from '../../../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../../../utils/rateLimitEndpoint';
import { invalidateSchema } from '../../../../graphql/schema';
import { assertSchemaEditable } from '../../../../utils/schemaReadOnly';

export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  enforceMutationRateLimit(event, 'content-type-fields.delete');
  const contentTypeId = assertUuid(getRouterParam(event, 'id'), 'id');
  const fieldId = assertUuid(getRouterParam(event, 'fieldId'), 'fieldId');

  // Verify field exists and belongs to this content type
  const field = await prisma.contentTypeField.findUnique({
    where: { id: fieldId },
  });
  if (!field || field.contentTypeId !== contentTypeId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Field not found',
    });
  }

  // Block deleting the only ENTRY_TITLE field
  if (field.type === 'ENTRY_TITLE') {
    const entryTitleCount = await prisma.contentTypeField.count({
      where: { contentTypeId, type: 'ENTRY_TITLE' },
    });
    if (entryTitleCount <= 1) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'Cannot delete the only ENTRY_TITLE field. A content type must have at least one.',
      });
    }
  }

  await withPrismaErrors(
    () => prisma.contentTypeField.delete({ where: { id: fieldId } }),
    { notFoundMessage: 'Field not found' }
  );

  invalidateSchema();

  return { success: true };
});
