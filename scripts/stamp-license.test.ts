import { describe, expect, it } from 'vitest';
import { addYearsUTC, stampLicense } from './stamp-license';

const FIXTURE = `Business Source License 1.1

Parameters

Licensed Work:        boject-cms %%VERSION%%
Change Date:          %%CHANGE_DATE%%

-----------------------------------------------------------------------------

Terms body stays.

-----------------------------------------------------------------------------

Change Date notice (non-normative — not part of the Business Source License)

In this repository's source form, the Parameters above use placeholder tokens:
"%%VERSION%%" is the published version and "%%CHANGE_DATE%%" is the Change Date.
Tracked in issue #338.
`;

describe('addYearsUTC', () => {
  it('adds whole years, keeping month/day', () => {
    expect(addYearsUTC('2026-07-06', 4)).toBe('2030-07-06');
  });
  it('handles a leap day (target year is also leap)', () => {
    expect(addYearsUTC('2028-02-29', 4)).toBe('2032-02-29');
  });
});

describe('stampLicense', () => {
  it('replaces both tokens and strips the non-normative notice', () => {
    const out = stampLicense(FIXTURE, {
      version: '0.0.1-rc.1',
      date: '2030-07-06',
    });
    expect(out).toContain('boject-cms 0.0.1-rc.1');
    expect(out).toContain('Change Date:          2030-07-06');
    expect(out).toContain('Terms body stays.');
    expect(out).not.toContain('%%');
    expect(out).not.toContain('Change Date notice');
    expect(out).not.toContain("repository's source form");
  });
  it('throws if a token is missing (drift / already stamped)', () => {
    expect(() =>
      stampLicense('no tokens here', { version: '1.0.0', date: '2030-01-01' })
    ).toThrow(/%%VERSION%%/);
  });
});
