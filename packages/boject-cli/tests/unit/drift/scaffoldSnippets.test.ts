import { describe, expect, it } from 'vitest';
import { renderDockerCompose } from '../../../../create-boject-cms/src/templates/dockerCompose.js';
import {
  CMS_DEPENDS_ON_LINES,
  MEILI_VOLUME_LINE,
  MEILISEARCH_SERVICE_BLOCK,
  REDIS_SERVICE_BLOCK,
  releaseNotesUrl,
  searchCacheEnvLines,
} from '../../../src/drift/scaffoldSnippets.js';

describe('scaffold snippets', () => {
  it('service blocks match the create-boject-cms template', () => {
    const out = renderDockerCompose({ imageTag: 'x', starter: 'none' });
    expect(out).toContain(MEILISEARCH_SERVICE_BLOCK);
    expect(out).toContain(REDIS_SERVICE_BLOCK);
    expect(out).toContain(MEILI_VOLUME_LINE);
    for (const line of CMS_DEPENDS_ON_LINES) expect(out).toContain(line);
  });

  it('searchCacheEnvLines emits only missing keys in fixed order', () => {
    expect(searchCacheEnvLines(['REDIS_URL', 'MEILI_URL'], 'k')).toEqual([
      'MEILI_URL=http://meilisearch:7700',
      'REDIS_URL=redis://redis:6379',
    ]);
    expect(searchCacheEnvLines(['MEILI_MASTER_KEY'], 'k')).toEqual([
      'MEILI_MASTER_KEY=k',
    ]);
  });

  it('releaseNotesUrl links the tag', () => {
    expect(releaseNotesUrl('0.0.3')).toBe(
      'https://github.com/bojectify/boject-cms/releases/tag/v0.0.3'
    );
  });
});
