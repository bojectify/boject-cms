export interface IntrospectParams {
  url: string;
  apiKey: string;
  contentTypeIdentifier: string;
}

export type IntrospectResult =
  | {
      ok: true;
      listField: string;
      datetimeFields: string[];
      singleTargetRelationFields: string[];
    }
  | { ok: false; error: string };

interface RawFieldType {
  kind: string;
  name: string | null;
  ofType?: RawFieldType | null;
}
interface RawField {
  name: string;
  type: RawFieldType;
}
interface RawIntrospectResponse {
  data?: {
    __type: { name: string; kind: string; fields: RawField[] } | null;
    __schema?: { queryType: { fields: { name: string }[] } };
  };
  errors?: { message: string }[];
}

const QUERY = `
  query Introspect($name: String!) {
    __type(name: $name) {
      name
      kind
      fields {
        name
        type {
          kind
          name
          ofType { kind name ofType { kind name } }
        }
      }
    }
    __schema {
      queryType {
        fields { name }
      }
    }
  }
`;

function camelCase(input: string): string {
  if (input.length === 0) return input;
  return input[0]!.toLowerCase() + input.slice(1);
}

function unwrapType(t: RawFieldType): RawFieldType {
  // Strip NON_NULL and LIST wrappers; we want to know if the underlying
  // is a SCALAR (DateTime) or OBJECT (relation). Polymorphic / multi-
  // target relations land in UNION, which we deliberately skip — only
  // single-target RELATION fields qualify for the `relation` shape.
  let cur = t;
  while (cur.kind === 'NON_NULL' || cur.kind === 'LIST') {
    if (!cur.ofType) return cur;
    cur = cur.ofType;
  }
  return cur;
}

function isMultiValued(t: RawFieldType): boolean {
  let cur = t;
  while (cur.kind === 'NON_NULL') {
    if (!cur.ofType) return false;
    cur = cur.ofType;
  }
  return cur.kind === 'LIST';
}

export async function introspectContentType(
  params: IntrospectParams
): Promise<IntrospectResult> {
  const res = await fetch(`${params.url.replace(/\/$/, '')}/api/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { name: params.contentTypeIdentifier },
    }),
  });
  if (res.status === 401) {
    return {
      ok: false,
      error:
        'API key was rejected (401). Set BOJECT_API_KEY or pass --api-key. Mint with `boject apikey create --scopes content:read`.',
    };
  }
  if (res.status === 403) {
    return {
      ok: false,
      error:
        'API key lacks the content:read scope (403). Mint a fresh key with --scopes content:read or update the existing key.',
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: `Introspection failed (HTTP ${res.status}): ${await res.text()}`,
    };
  }
  const body = (await res.json()) as RawIntrospectResponse;
  if (body.errors?.length) {
    return {
      ok: false,
      error: `GraphQL errors: ${body.errors.map((e) => e.message).join('; ')}`,
    };
  }
  const t = body.data?.__type;
  if (!t) {
    return {
      ok: false,
      error: `Content type "${params.contentTypeIdentifier}" not found in schema. Check the identifier (PascalCase) or run \`boject schema pull\`.`,
    };
  }
  const expectedListField = `${camelCase(params.contentTypeIdentifier)}List`;
  const queryFields = body.data?.__schema?.queryType.fields ?? [];
  if (!queryFields.some((f) => f.name === expectedListField)) {
    return {
      ok: false,
      error: `Content type "${params.contentTypeIdentifier}" exists but root query field "${expectedListField}" is missing — schema may be out of date.`,
    };
  }

  const datetimeFields: string[] = [];
  const singleTargetRelationFields: string[] = [];
  for (const f of t.fields) {
    const inner = unwrapType(f.type);
    if (inner.kind === 'SCALAR' && inner.name === 'DateTime') {
      datetimeFields.push(f.name);
    } else if (inner.kind === 'OBJECT' && !isMultiValued(f.type)) {
      // OBJECT under a non-LIST wrapper = single-target RELATION.
      singleTargetRelationFields.push(f.name);
    }
  }

  return {
    ok: true,
    listField: expectedListField,
    datetimeFields,
    singleTargetRelationFields,
  };
}
