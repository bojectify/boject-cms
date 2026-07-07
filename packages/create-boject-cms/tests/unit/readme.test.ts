import { describe, expect, it } from 'vitest';
import { renderReadme } from '../../src/templates/readme.js';

describe('renderReadme', () => {
  it('includes the docker compose up command', () => {
    const md = renderReadme({
      starter: 'base',
      adminEmail: 'admin@local',
      hostPort: 4000,
    });
    expect(md).toContain('docker compose up -d');
  });

  it('references the login URL (http://localhost:4000/login)', () => {
    const md = renderReadme({
      starter: 'base',
      adminEmail: 'admin@local',
      hostPort: 4000,
    });
    expect(md).toContain('http://localhost:4000/login');
  });

  it('mentions the admin email', () => {
    const md = renderReadme({
      starter: 'base',
      adminEmail: 'admin@local',
      hostPort: 4000,
    });
    expect(md).toContain('admin@local');
  });

  it('tells the user the admin password lives in .env', () => {
    const md = renderReadme({
      starter: 'base',
      adminEmail: 'admin@local',
      hostPort: 4000,
    });
    expect(md).toMatch(/BOJECT_ADMIN_PASSWORD.*\.env/s);
  });

  it('mentions the selected starter when one was imported', () => {
    const md = renderReadme({
      starter: 'sport',
      adminEmail: 'admin@local',
      hostPort: 4000,
    });
    expect(md).toContain('sport');
  });

  it('does not promise a starter import when starter is "none"', () => {
    const md = renderReadme({
      starter: 'none',
      adminEmail: 'admin@local',
      hostPort: 4000,
    });
    expect(md.toLowerCase()).not.toContain('starter will be imported');
  });

  it('includes a Content types section explaining schema-as-code', () => {
    const out = renderReadme({
      starter: 'base',
      adminEmail: 'admin@local',
      hostPort: 4000,
    });
    expect(out).toContain('## Content types');
    expect(out).toContain('content-types/schema.boject.json');
  });

  it('uses the hostPort in the login URL and mentions BOJECT_HOST_PORT', () => {
    const out = renderReadme({
      starter: 'base',
      adminEmail: 'admin@local',
      hostPort: 4100,
    });
    expect(out).toContain('http://localhost:4100/login');
    expect(out).toContain('BOJECT_HOST_PORT');
  });
});
