import { describe, expect, it } from 'vitest';
import { renderReadme } from '../../src/templates/readme.js';

describe('renderReadme', () => {
  it('includes the docker compose up command', () => {
    const md = renderReadme({
      starter: 'web-base',
      adminEmail: 'admin@local',
      hostPort: 4000,
      aiAssist: false,
    });
    expect(md).toContain('docker compose up -d');
  });

  it('references the login URL (http://localhost:4000/login)', () => {
    const md = renderReadme({
      starter: 'web-base',
      adminEmail: 'admin@local',
      hostPort: 4000,
      aiAssist: false,
    });
    expect(md).toContain('http://localhost:4000/login');
  });

  it('mentions the admin email', () => {
    const md = renderReadme({
      starter: 'web-base',
      adminEmail: 'admin@local',
      hostPort: 4000,
      aiAssist: false,
    });
    expect(md).toContain('admin@local');
  });

  it('tells the user the admin password lives in .env', () => {
    const md = renderReadme({
      starter: 'web-base',
      adminEmail: 'admin@local',
      hostPort: 4000,
      aiAssist: false,
    });
    expect(md).toMatch(/BOJECT_ADMIN_PASSWORD.*\.env/s);
  });

  it('mentions the selected starter when one was imported', () => {
    const md = renderReadme({
      starter: 'sport',
      adminEmail: 'admin@local',
      hostPort: 4000,
      aiAssist: false,
    });
    expect(md).toContain('sport');
  });

  it('does not promise a starter import when starter is "none"', () => {
    const md = renderReadme({
      starter: 'none',
      adminEmail: 'admin@local',
      hostPort: 4000,
      aiAssist: false,
    });
    expect(md.toLowerCase()).not.toContain('starter will be imported');
  });

  it('includes a Content types section explaining schema-as-code', () => {
    const out = renderReadme({
      starter: 'web-base',
      adminEmail: 'admin@local',
      hostPort: 4000,
      aiAssist: false,
    });
    expect(out).toContain('## Content types');
    expect(out).toContain('content-types/schema.boject.json');
  });

  it('uses the hostPort in the login URL and mentions BOJECT_HOST_PORT', () => {
    const out = renderReadme({
      starter: 'web-base',
      adminEmail: 'admin@local',
      hostPort: 4100,
      aiAssist: false,
    });
    expect(out).toContain('http://localhost:4100/login');
    expect(out).toContain('BOJECT_HOST_PORT');
  });

  it('mentions the Meilisearch and Redis sidecars', () => {
    const md = renderReadme({
      starter: 'web-base',
      adminEmail: 'admin@local',
      hostPort: 4000,
      aiAssist: false,
    });
    expect(md).toContain('Meilisearch');
    expect(md).toContain('Redis');
  });
});

describe('renderReadme — AI-assisted modelling', () => {
  const base = {
    starter: 'none' as const,
    adminEmail: 'admin@local',
    hostPort: 4000,
  };

  it('includes the AI section and the exact prompt command when enabled', () => {
    const out = renderReadme({ ...base, aiAssist: true });
    expect(out).toContain('## AI-assisted content modelling');
    expect(out).toContain('/mcp__boject__model_content');
  });

  it('omits the AI section when disabled', () => {
    const out = renderReadme({ ...base, aiAssist: false });
    expect(out).not.toContain('AI-assisted content modelling');
    expect(out).not.toContain('/mcp__boject__');
  });
});
