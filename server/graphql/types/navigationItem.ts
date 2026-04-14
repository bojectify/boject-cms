import type { Builder } from '../builder';

export function registerNavigationItemType(builder: Builder) {
  builder.prismaObject('NavigationItem', {
    fields: (t) => ({
      id: t.exposeID('id'),
      order: t.exposeInt('order'),
      link: t.relation('link'),
      parent: t.relation('parent', { nullable: true }),
      children: t.relatedConnection('children', {
        cursor: 'id',
        query: () => ({ orderBy: { order: 'asc' } }),
      }),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    }),
  });
}
