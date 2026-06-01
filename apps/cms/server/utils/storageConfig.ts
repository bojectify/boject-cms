export type StorageSpec = Record<
  string,
  { driver: string; [key: string]: unknown }
>;

export function buildStorageConfig(): StorageSpec {
  const driver = process.env.STORAGE_DRIVER ?? 'local';

  if (driver === 'local') {
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

  if (driver === 's3' || driver === 'r2') {
    const bucket =
      driver === 'r2' ? required('R2_BUCKET') : required('S3_BUCKET');
    const accessKeyId =
      driver === 'r2'
        ? required('R2_ACCESS_KEY_ID')
        : required('AWS_ACCESS_KEY_ID');
    const secretAccessKey =
      driver === 'r2'
        ? required('R2_SECRET_ACCESS_KEY')
        : required('AWS_SECRET_ACCESS_KEY');
    const region = driver === 'r2' ? 'auto' : required('AWS_REGION');
    const endpoint =
      driver === 'r2'
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
    `Unsupported STORAGE_DRIVER: "${driver}". Expected one of: local, s3, r2.`
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
