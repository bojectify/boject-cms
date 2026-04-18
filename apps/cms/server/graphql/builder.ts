import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import PrismaUtilsPlugin from '@pothos/plugin-prisma-utils';
import RelayPlugin from '@pothos/plugin-relay';
import type PrismaTypes from '#generated/pothos-types';
import { getDatamodel } from '#generated/pothos-types';
import { prisma } from '../utils/prisma';

export type Builder = InstanceType<typeof SchemaBuilder<BuilderTypes>>;

type BuilderTypes = {
  PrismaTypes: PrismaTypes;
  Scalars: {
    DateTime: { Input: Date | string; Output: Date | string };
    JSON: {
      Input: unknown;
      Output: unknown;
    };
  };
};

export function createBuilder(): Builder {
  const builder = new SchemaBuilder<BuilderTypes>({
    plugins: [PrismaPlugin, PrismaUtilsPlugin, RelayPlugin],
    prisma: {
      client: prisma,
      dmmf: getDatamodel(),
    },
    relay: {},
  });

  builder.scalarType('DateTime', {
    serialize: (value) =>
      value instanceof Date ? value.toISOString() : String(value),
    parseValue: (value) => new Date(String(value)),
  });

  builder.scalarType('JSON', {
    serialize: (value) => value,
    parseValue: (value) => value,
  });

  return builder;
}
