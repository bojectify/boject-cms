import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readComposeImage, writeComposeImage } from '../../src/compose.js';

const FIXTURE = `services:
  # This is the CMS container — managed by \`boject upgrade\`.
  cms:
    image: ghcr.io/bojectify/boject-cms:1.2.3
    restart: unless-stopped
    ports:
      - '4000:3000'
    env_file:
      - .env
    depends_on:
      - db
  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: boject
      POSTGRES_PASSWORD: boject
      POSTGRES_DB: boject
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`;

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-cli-compose-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('readComposeImage', () => {
  it('extracts services.cms.image', async () => {
    const path = join(workDir, 'docker-compose.yml');
    await writeFile(path, FIXTURE);
    expect(await readComposeImage(path)).toBe(
      'ghcr.io/bojectify/boject-cms:1.2.3'
    );
  });

  it('throws when services.cms.image is missing', async () => {
    const path = join(workDir, 'docker-compose.yml');
    await writeFile(path, 'services:\n  db:\n    image: postgres:17\n');
    await expect(readComposeImage(path)).rejects.toThrow(
      /services\.cms\.image/
    );
  });

  it('throws when the file is missing', async () => {
    const path = join(workDir, 'no-such.yml');
    await expect(readComposeImage(path)).rejects.toThrow();
  });
});

describe('writeComposeImage', () => {
  it('rewrites services.cms.image and preserves comments + other services', async () => {
    const path = join(workDir, 'docker-compose.yml');
    await writeFile(path, FIXTURE);
    await writeComposeImage(path, 'ghcr.io/bojectify/boject-cms:1.3.0');
    const out = await readFile(path, 'utf8');
    expect(out).toContain('image: ghcr.io/bojectify/boject-cms:1.3.0');
    expect(out).toContain(
      '# This is the CMS container — managed by `boject upgrade`.'
    );
    expect(out).toContain('image: postgres:17');
    expect(out).toContain('POSTGRES_USER: boject');
  });

  it('leaves the db image untouched', async () => {
    const path = join(workDir, 'docker-compose.yml');
    await writeFile(path, FIXTURE);
    await writeComposeImage(path, 'ghcr.io/bojectify/boject-cms:2.0.0');
    const out = await readFile(path, 'utf8');
    expect(out).toContain('image: ghcr.io/bojectify/boject-cms:2.0.0');
    expect(out).toContain('image: postgres:17');
    expect(out).not.toContain('ghcr.io/bojectify/boject-cms:1.2.3');
  });

  it('preserves unrelated formatting exactly', async () => {
    const path = join(workDir, 'docker-compose.yml');
    const withBlankLines = `services:\n\n  cms:\n    image: x:1\n\n  db:\n    image: postgres:17\n`;
    await writeFile(path, withBlankLines);
    await writeComposeImage(path, 'x:2');
    const out = await readFile(path, 'utf8');
    expect(out).toContain('image: x:2');
    expect(out).toContain('image: postgres:17');
    expect(out.indexOf('cms:')).toBeLessThan(out.indexOf('db:'));
  });
});
