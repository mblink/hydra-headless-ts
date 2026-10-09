import { describe, expect, it } from 'vitest';
import { findDisallowedRedirectUri, isRedirectUriAllowed } from './redirectUri.js';

const policy = { allowed: ['https://claude.ai/api/mcp/auth_callback'], allowLoopback: true };

describe('isRedirectUriAllowed', () => {
  it('accepts an exact configured URI', () => {
    expect(isRedirectUriAllowed('https://claude.ai/api/mcp/auth_callback', policy)).toBe(true);
  });

  it('rejects anything that only resembles a configured URI', () => {
    expect(isRedirectUriAllowed('https://claude.ai/api/mcp/auth_callback/', policy)).toBe(false);
    expect(isRedirectUriAllowed('https://claude.ai/api/mcp/auth_callback?x=1', policy)).toBe(false);
    expect(isRedirectUriAllowed('https://claude.ai.evil.com/api/mcp/auth_callback', policy)).toBe(false);
    expect(isRedirectUriAllowed('https://evil.com/cb', policy)).toBe(false);
  });

  it('accepts http loopback URIs on any port and path', () => {
    expect(isRedirectUriAllowed('http://localhost:6274/oauth/callback', policy)).toBe(true);
    expect(isRedirectUriAllowed('http://127.0.0.1:33418/callback', policy)).toBe(true);
    expect(isRedirectUriAllowed('http://[::1]:8080/cb', policy)).toBe(true);
  });

  it('rejects loopback look-alikes', () => {
    expect(isRedirectUriAllowed('https://localhost:6274/cb', policy)).toBe(false);
    expect(isRedirectUriAllowed('http://localhost.evil.com/cb', policy)).toBe(false);
    expect(isRedirectUriAllowed('http://user:pw@localhost/cb', policy)).toBe(false);
    expect(isRedirectUriAllowed('not a url', policy)).toBe(false);
  });

  it('rejects loopback URIs when they are turned off', () => {
    expect(isRedirectUriAllowed('http://localhost:6274/cb', { ...policy, allowLoopback: false })).toBe(false);
  });
});

describe('findDisallowedRedirectUri', () => {
  it('passes when every URI is allowed', () => {
    expect(
      findDisallowedRedirectUri(['https://claude.ai/api/mcp/auth_callback', 'http://localhost:1/cb'], policy),
    ).toBeUndefined();
  });

  it('names the first rejected URI', () => {
    expect(findDisallowedRedirectUri(['https://claude.ai/api/mcp/auth_callback', 'https://evil.com/cb'], policy)).toBe(
      'redirect_uri is not allowed: https://evil.com/cb',
    );
  });

  it('rejects a missing, empty or non-string list', () => {
    expect(findDisallowedRedirectUri(undefined, policy)).toBe('redirect_uris must be a non-empty array');
    expect(findDisallowedRedirectUri([], policy)).toBe('redirect_uris must be a non-empty array');
    expect(findDisallowedRedirectUri([42], policy)).toBe('redirect_uri is not allowed: 42');
  });
});
