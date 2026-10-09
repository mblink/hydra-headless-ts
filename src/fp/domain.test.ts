import { Schema } from 'effect';
import { describe, it, expect } from 'vitest';
import {
  PKCEMethodSchema,
  PKCEStateSchema,
  GrantTypeSchema,
  AuthCodeGrantSchema,
  RefreshTokenGrantSchema,
  TokenRequestSchema,
  GoogleTokenResponseSchema,
  GoogleUserInfoSchema,
  GoogleErrorResponseSchema,
  type PKCEState,
  type AuthCodeGrant,
  type RefreshTokenGrant,
  type GoogleTokenResponse,
  type GoogleUserInfoResponse,
} from './domain.js';

describe('Domain Schemas', () => {
  describe('PKCEMethodSchema', () => {
    it('should validate S256 method', () => {
      const result = Schema.decodeUnknownSync(PKCEMethodSchema)('S256');
      expect(result).toBe('S256');
    });

    it('should validate plain method', () => {
      const result = Schema.decodeUnknownSync(PKCEMethodSchema)('plain');
      expect(result).toBe('plain');
    });

    it('should reject invalid method', () => {
      expect(() => Schema.decodeUnknownSync(PKCEMethodSchema)('invalid')).toThrow();
    });
  });

  describe('PKCEStateSchema', () => {
    it('should validate valid PKCE state', () => {
      const validState: PKCEState = {
        code_challenge: 'challenge-123',
        code_challenge_method: 'S256',
        scope: 'openid profile',
        state: 'state-123',
        redirect_uri: 'https://example.com/callback',
        client_id: 'client-123',
        timestamp: Date.now(),
      };

      const result = Schema.decodeUnknownSync(PKCEStateSchema)(validState);
      expect(result).toEqual(validState);
    });

    it('should reject PKCE state with missing fields', () => {
      const invalidState = {
        code_challenge: 'challenge-123',
        code_challenge_method: 'S256',
        // Missing required fields
      };

      expect(() => Schema.decodeUnknownSync(PKCEStateSchema)(invalidState)).toThrow();
    });

    it('should reject invalid challenge method', () => {
      const invalidState = {
        code_challenge: 'challenge-123',
        code_challenge_method: 'MD5', // Invalid method
        scope: 'openid',
        state: 'state',
        redirect_uri: 'https://example.com',
        client_id: 'client',
        timestamp: Date.now(),
      };

      expect(() => Schema.decodeUnknownSync(PKCEStateSchema)(invalidState)).toThrow();
    });

    it('should reject non-numeric timestamp', () => {
      const invalidState = {
        code_challenge: 'challenge-123',
        code_challenge_method: 'S256',
        scope: 'openid',
        state: 'state',
        redirect_uri: 'https://example.com',
        client_id: 'client',
        timestamp: 'not-a-number',
      };

      expect(() => Schema.decodeUnknownSync(PKCEStateSchema)(invalidState)).toThrow();
    });
  });

  describe('GrantTypeSchema', () => {
    it('should validate authorization_code grant type', () => {
      const result = Schema.decodeUnknownSync(GrantTypeSchema)('authorization_code');
      expect(result).toBe('authorization_code');
    });

    it('should validate refresh_token grant type', () => {
      const result = Schema.decodeUnknownSync(GrantTypeSchema)('refresh_token');
      expect(result).toBe('refresh_token');
    });

    it('should reject invalid grant type', () => {
      expect(() => Schema.decodeUnknownSync(GrantTypeSchema)('client_credentials')).toThrow();
    });
  });

  describe('AuthCodeGrantSchema', () => {
    it('should validate valid auth code grant', () => {
      const validGrant: AuthCodeGrant = {
        grant_type: 'authorization_code',
        code: 'auth-code-123',
        code_verifier: 'verifier-123',
        redirect_uri: 'https://example.com/callback',
        client_id: 'client-123',
      };

      const result = Schema.decodeUnknownSync(AuthCodeGrantSchema)(validGrant);
      expect(result).toEqual(validGrant);
    });

    it('should reject auth code grant with wrong grant_type', () => {
      const invalidGrant = {
        grant_type: 'refresh_token',
        code: 'auth-code-123',
        code_verifier: 'verifier-123',
        redirect_uri: 'https://example.com/callback',
        client_id: 'client-123',
      };

      expect(() => Schema.decodeUnknownSync(AuthCodeGrantSchema)(invalidGrant)).toThrow();
    });

    it('should reject auth code grant with missing fields', () => {
      const invalidGrant = {
        grant_type: 'authorization_code',
        code: 'auth-code-123',
        // Missing code_verifier, redirect_uri, client_id
      };

      expect(() => Schema.decodeUnknownSync(AuthCodeGrantSchema)(invalidGrant)).toThrow();
    });
  });

  describe('RefreshTokenGrantSchema', () => {
    it('should validate valid refresh token grant', () => {
      const validGrant: RefreshTokenGrant = {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token-123',
        client_id: 'client-123',
      };

      const result = Schema.decodeUnknownSync(RefreshTokenGrantSchema)(validGrant);
      expect(result).toEqual(validGrant);
    });

    it('should validate refresh token grant with optional scope', () => {
      const validGrant: RefreshTokenGrant = {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token-123',
        client_id: 'client-123',
        scope: 'openid profile',
      };

      const result = Schema.decodeUnknownSync(RefreshTokenGrantSchema)(validGrant);
      expect(result).toEqual(validGrant);
    });

    it('should reject refresh grant with wrong grant_type', () => {
      const invalidGrant = {
        grant_type: 'authorization_code',
        refresh_token: 'refresh-token-123',
        client_id: 'client-123',
      };

      expect(() => Schema.decodeUnknownSync(RefreshTokenGrantSchema)(invalidGrant)).toThrow();
    });
  });

  describe('TokenRequestSchema', () => {
    it('should validate auth code grant as token request', () => {
      const authCodeGrant: AuthCodeGrant = {
        grant_type: 'authorization_code',
        code: 'code-123',
        code_verifier: 'verifier-123',
        redirect_uri: 'https://example.com',
        client_id: 'client-123',
      };

      const result = Schema.decodeUnknownSync(TokenRequestSchema)(authCodeGrant);
      expect(result).toEqual(authCodeGrant);
    });

    it('should validate refresh token grant as token request', () => {
      const refreshGrant: RefreshTokenGrant = {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-123',
        client_id: 'client-123',
      };

      const result = Schema.decodeUnknownSync(TokenRequestSchema)(refreshGrant);
      expect(result).toEqual(refreshGrant);
    });

    it('should reject invalid token request', () => {
      const invalidRequest = {
        grant_type: 'password',
        username: 'user',
        password: 'pass',
      };

      expect(() => Schema.decodeUnknownSync(TokenRequestSchema)(invalidRequest)).toThrow();
    });
  });

  describe('GoogleTokenResponseSchema', () => {
    it('should validate complete token response', () => {
      const validResponse: GoogleTokenResponse = {
        access_token: 'access-token-123',
        expires_in: 3600,
        scope: 'openid profile email',
        token_type: 'Bearer',
        id_token: 'id-token-123',
        refresh_token: 'refresh-token-123',
      };

      const result = Schema.decodeUnknownSync(GoogleTokenResponseSchema)(validResponse);
      expect(result).toEqual(validResponse);
    });

    it('should validate token response without optional fields', () => {
      const validResponse: GoogleTokenResponse = {
        access_token: 'access-token-123',
        expires_in: 3600,
        scope: 'openid',
        token_type: 'Bearer',
      };

      const result = Schema.decodeUnknownSync(GoogleTokenResponseSchema)(validResponse);
      expect(result).toEqual(validResponse);
    });

    it('should reject token response with missing required fields', () => {
      const invalidResponse = {
        access_token: 'access-token-123',
        // Missing expires_in, scope, token_type
      };

      expect(() => Schema.decodeUnknownSync(GoogleTokenResponseSchema)(invalidResponse)).toThrow();
    });

    it('should reject token response with wrong types', () => {
      const invalidResponse = {
        access_token: 123, // Should be string
        expires_in: '3600', // Should be number
        scope: 'openid',
        token_type: 'Bearer',
      };

      expect(() => Schema.decodeUnknownSync(GoogleTokenResponseSchema)(invalidResponse)).toThrow();
    });
  });

  describe('GoogleUserInfoSchema', () => {
    it('should validate complete user info', () => {
      const validUserInfo: GoogleUserInfoResponse = {
        id: 'user-123',
        email: 'user@example.com',
        verified_email: true,
        name: 'Test User',
        given_name: 'Test',
        family_name: 'User',
        picture: 'https://example.com/photo.jpg',
        locale: 'en',
      };

      const result = Schema.decodeUnknownSync(GoogleUserInfoSchema)(validUserInfo);
      expect(result).toEqual(validUserInfo);
    });

    it('should validate user info with only required fields', () => {
      const validUserInfo: GoogleUserInfoResponse = {
        id: 'user-123',
        email: 'user@example.com',
        verified_email: true,
      };

      const result = Schema.decodeUnknownSync(GoogleUserInfoSchema)(validUserInfo);
      expect(result).toEqual(validUserInfo);
    });

    it('should reject user info with missing required fields', () => {
      const invalidUserInfo = {
        id: 'user-123',
        email: 'user@example.com',
        // Missing verified_email
      };

      expect(() => Schema.decodeUnknownSync(GoogleUserInfoSchema)(invalidUserInfo)).toThrow();
    });

    it('should reject user info with wrong boolean type', () => {
      const invalidUserInfo = {
        id: 'user-123',
        email: 'user@example.com',
        verified_email: 'true', // Should be boolean
      };

      expect(() => Schema.decodeUnknownSync(GoogleUserInfoSchema)(invalidUserInfo)).toThrow();
    });
  });

  describe('GoogleErrorResponseSchema', () => {
    it('should validate error response with description', () => {
      const validError = {
        error: 'invalid_grant',
        error_description: 'The refresh token is invalid',
      };

      const result = Schema.decodeUnknownSync(GoogleErrorResponseSchema)(validError);
      expect(result).toEqual(validError);
    });

    it('should validate error response without description', () => {
      const validError = {
        error: 'invalid_request',
      };

      const result = Schema.decodeUnknownSync(GoogleErrorResponseSchema)(validError);
      expect(result).toEqual(validError);
    });

    it('should reject error response with missing error field', () => {
      const invalidError = {
        error_description: 'Some error occurred',
      };

      expect(() => Schema.decodeUnknownSync(GoogleErrorResponseSchema)(invalidError)).toThrow();
    });
  });

  describe('Type inference', () => {
    it('should correctly infer PKCEState type', () => {
      const state: PKCEState = {
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
        scope: 'openid',
        state: 'state',
        redirect_uri: 'https://example.com',
        client_id: 'client',
        timestamp: 123456789,
      };

      // Type check - should compile without errors
      expect(state.code_challenge).toBe('challenge');
      expect(state.code_challenge_method).toBe('S256');
    });

    it('should correctly infer AuthCodeGrant type', () => {
      const grant: AuthCodeGrant = {
        grant_type: 'authorization_code',
        code: 'code',
        code_verifier: 'verifier',
        redirect_uri: 'https://example.com',
        client_id: 'client',
      };

      // Type check - should compile without errors
      expect(grant.grant_type).toBe('authorization_code');
      expect(grant.code_verifier).toBe('verifier');
    });
  });

  describe('Schema encoding', () => {
    it('should encode PKCEState back to JSON', () => {
      const state: PKCEState = {
        code_challenge: 'challenge-123',
        code_challenge_method: 'S256',
        scope: 'openid',
        state: 'state-123',
        redirect_uri: 'https://example.com',
        client_id: 'client-123',
        timestamp: 1234567890,
      };

      const encoded = Schema.encodeSync(PKCEStateSchema)(state);
      expect(encoded).toEqual(state);
    });

    it('should round-trip decode and encode', () => {
      const original: GoogleTokenResponse = {
        access_token: 'token',
        expires_in: 3600,
        scope: 'openid',
        token_type: 'Bearer',
      };

      const decoded = Schema.decodeUnknownSync(GoogleTokenResponseSchema)(original);
      const encoded = Schema.encodeSync(GoogleTokenResponseSchema)(decoded);

      expect(encoded).toEqual(original);
    });
  });
});
