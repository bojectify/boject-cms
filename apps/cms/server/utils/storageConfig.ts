export type StorageSpec = Record<
  string,
  { driver: string; [key: string]: unknown }
>;

/**
 * Recognised `STORAGE_DRIVER` env values. Note these are our deployment-mode
 * names, distinct from the underlying unstorage driver identifiers in the
 * returned spec (`local` maps to unstorage's `fs` driver; `s3`/`r2` both map
 * to `s3`).
 */
export const STORAGE_DRIVERS = {
  LOCAL: 'local',
  S3: 's3',
  R2: 'r2',
} as const;

export type StorageDriver =
  (typeof STORAGE_DRIVERS)[keyof typeof STORAGE_DRIVERS];

export function buildStorageConfig(): StorageSpec {
  const driver = process.env.STORAGE_DRIVER ?? STORAGE_DRIVERS.LOCAL;

  if (driver === STORAGE_DRIVERS.LOCAL) {
    const base = process.env.STORAGE_LOCAL_BASE ?? '/app/storage';
    return {
      'images:originals': {
        driver: 'fs',
        base: `${base}/images/originals`,
      },
      'images:transforms': {
        driver: 'fs',
        base: `${base}/images/transforms`,
      },
    };
  }

  if (driver === STORAGE_DRIVERS.S3 || driver === STORAGE_DRIVERS.R2) {
    const isR2 = driver === STORAGE_DRIVERS.R2;
    const bucket = isR2 ? required('R2_BUCKET') : required('S3_BUCKET');
    const accessKeyId = isR2
      ? required('R2_ACCESS_KEY_ID')
      : required('AWS_ACCESS_KEY_ID');
    const secretAccessKey = isR2
      ? required('R2_SECRET_ACCESS_KEY')
      : required('AWS_SECRET_ACCESS_KEY');
    const region = isR2 ? 'auto' : required('AWS_REGION');
    const endpoint = isR2
      ? `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`
      : undefined;

    const base = {
      driver: 's3',
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      ...(endpoint ? { endpoint } : {}),
    };

    return {
      'images:originals': { ...base, pathPrefix: 'images/originals/' },
      'images:transforms': { ...base, pathPrefix: 'images/transforms/' },
    };
  }

  throw new Error(
    `Unsupported STORAGE_DRIVER: "${driver}". Expected one of: ${Object.values(
      STORAGE_DRIVERS
    ).join(', ')}.`
  );
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name} for the configured STORAGE_DRIVER`
    );
  }
  return v;
}
