import { describe, expect, it } from 'vitest';
import {
  GRAPHIQL_HEADERS_PLACEHOLDER,
  isGraphiqlEnabled,
  renderGraphiqlPage,
  wantsGraphiqlPage,
} from './graphiqlPage';

describe('isGraphiqlEnabled', () => {
  it('is on for "true" and "1"', () => {
    expect(isGraphiqlEnabled({ BOJECT_GRAPHIQL: 'true' })).toBe(true);
    expect(isGraphiqlEnabled({ BOJECT_GRAPHIQL: '1' })).toBe(true);
  });

  it('is off when unset or any other value', () => {
    expect(isGraphiqlEnabled({})).toBe(false);
    expect(isGraphiqlEnabled({ BOJECT_GRAPHIQL: 'false' })).toBe(false);
    expect(isGraphiqlEnabled({ BOJECT_GRAPHIQL: 'yes' })).toBe(false);
  });
});

describe('wantsGraphiqlPage', () => {
  it('matches a browser GET that accepts HTML', () => {
    expect(
      wantsGraphiqlPage('GET', 'text/html,application/xhtml+xml,*/*;q=0.8')
    ).toBe(true);
  });

  it('does not match a POST, even one accepting HTML', () => {
    expect(wantsGraphiqlPage('POST', 'text/html')).toBe(false);
  });

  it('does not match a GET asking for JSON or sending no Accept header', () => {
    expect(wantsGraphiqlPage('GET', 'application/json')).toBe(false);
    expect(wantsGraphiqlPage('GET', undefined)).toBe(false);
  });
});

describe('renderGraphiqlPage', () => {
  it('renders the GraphiQL page pointed at /api/graphql', () => {
    const html = renderGraphiqlPage();
    expect(html).toContain('<html');
    expect(html).toContain('"endpoint":"/api/graphql"');
  });

  it('prefills an Authorization header placeholder and does not persist headers', () => {
    const html = renderGraphiqlPage();
    const opts = JSON.parse(
      html.match(/renderYogaGraphiQL\(root,(\{.*?\})\)/)![1]!
    );
    expect(opts.headers).toBe(GRAPHIQL_HEADERS_PLACEHOLDER);
    expect(JSON.parse(opts.headers)).toEqual({
      Authorization: expect.stringMatching(/^Bearer /),
    });
    expect(opts.shouldPersistHeaders).toBe(false);
  });
});
