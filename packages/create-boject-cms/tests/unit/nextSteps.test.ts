import { describe, expect, it } from 'vitest';
import { renderNextSteps } from '../../src/nextSteps.js';

const base = {
  targetDir: '/tmp/my-site',
  hostPort: 4100,
  adminEmail: 'admin@local',
  adminPassword: 'pw-value',
  aiAssist: false,
};

describe('renderNextSteps', () => {
  it('prints the start command and admin login', () => {
    const out = renderNextSteps({ ...base, cliApiKeyCreated: false });
    expect(out).toContain('cd /tmp/my-site');
    expect(out).toContain('docker compose up -d');
    expect(out).toContain('http://localhost:4100/login');
    expect(out).toContain('Email:    admin@local');
    expect(out).toContain('Password: pw-value');
  });

  it('mentions .env.local when a CLI key was created, without printing it (#510)', () => {
    const out = renderNextSteps({ ...base, cliApiKeyCreated: true });
    expect(out).toContain('.env.local');
    expect(out).not.toMatch(/boject_[0-9a-f]{64}/);
  });

  it('says nothing about a CLI key when none was created', () => {
    const out = renderNextSteps({ ...base, cliApiKeyCreated: false });
    expect(out).not.toContain('.env.local');
  });
});
