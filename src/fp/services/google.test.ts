import axios from 'axios'
import { Effect } from 'effect'
import { OAuth2Client } from 'google-auth-library'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { HttpStatusError, NetworkError, GoogleAuthError } from '../errors.js'
import { makeGoogleOAuthService, type GoogleOAuthConfig } from './google.js'
import type { GoogleTokenResponse, RefreshTokenData } from '../domain.js'

// Mock axios
vi.mock('axios')

// Mock google-auth-library
vi.mock('google-auth-library', () => ({
  // Vitest 4+ requires a function/class implementation for mocks called with `new`
  OAuth2Client: vi.fn(function () {
    return { generateAuthUrl: vi.fn(), getToken: vi.fn() }
  }),
}))

describe('GoogleOAuthService', () => {
  const mockConfig: GoogleOAuthConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://auth.example.com/callback',
  }

  let googleService: ReturnType<typeof makeGoogleOAuthService>

  beforeEach(() => {
    vi.clearAllMocks()
    googleService = makeGoogleOAuthService(mockConfig)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('refreshToken', () => {
    it('should refresh token successfully', async () => {
      const mockTokenData: RefreshTokenData = {
        refresh_token: 'refresh-token-123',
        client_id: 'test-client',
        access_token: 'test-access-token',
        scope: 'scopeOne scopeTwo',
        subject: 'test@test.tld',
        created_at: Date.now(),
        expires_in: 300,
        updated_at: Date.now(),
      }

      const mockResponse: GoogleTokenResponse = {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email',
        refresh_token: 'new-refresh-token',
      }

      vi.mocked(axios.post).mockResolvedValue({
        data: mockResponse,
        status: 200,
      })

      const program = googleService.refreshToken(mockTokenData)
      const result = await Effect.runPromise(program)

      expect(result).toEqual(mockResponse)
      expect(axios.post).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.any(String),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      )
      const body = new URLSearchParams(vi.mocked(axios.post).mock.calls[0][1] as string)
      expect(body.get('grant_type')).toBe('refresh_token')
      expect(body.get('refresh_token')).toBe('refresh-token-123')
      expect(body.get('client_id')).toBe('test-client-id')
      expect(body.get('client_secret')).toBe('test-client-secret')
    })

    it('should handle Google auth errors', async () => {
      const mockTokenData: RefreshTokenData = {
        refresh_token: 'refresh-token-123',
        client_id: 'test-client',
        access_token: 'test-access-token',
        scope: 'scopeOne scopeTwo',
        subject: 'test@test.tld',
        created_at: Date.now(),
        expires_in: 300,
        updated_at: Date.now(),
      }

      const axiosError = {
        isAxiosError: true,
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: {
            error: 'invalid_grant',
            error_description: 'Token has been revoked',
          },
        },
      }

      vi.mocked(axios.post).mockRejectedValue(axiosError)
      vi.mocked(axios.isAxiosError).mockReturnValue(true)

      const program = googleService.refreshToken(mockTokenData)
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(GoogleAuthError)
        const error = result.left as GoogleAuthError
        expect(error.error).toBe('invalid_grant')
      }
    })

    it('should handle network errors', async () => {
      const mockTokenData: RefreshTokenData = {
        refresh_token: 'refresh-token-123',
        client_id: 'test-client',
        access_token: 'test-access-token',
        scope: 'scopeOne scopeTwo',
        subject: 'test@test.tld',
        created_at: Date.now(),
        expires_in: 300,
        updated_at: Date.now(),
      }

      vi.mocked(axios.post).mockRejectedValue(new Error('Network timeout'))
      vi.mocked(axios.isAxiosError).mockReturnValue(false)

      const program = googleService.refreshToken(mockTokenData)
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(NetworkError)
      }
    })

    it('should handle schema validation errors', async () => {
      const mockTokenData: RefreshTokenData = {
        refresh_token: 'refresh-token-123',
        client_id: 'test-client',
        access_token: 'test-access-token',
        scope: 'scopeOne scopeTwo',
        subject: 'test@test.tld',
        created_at: Date.now(),
        expires_in: 300,
        updated_at: Date.now(),
      }

      // Invalid response missing required fields
      vi.mocked(axios.post).mockResolvedValue({
        data: { invalid: 'response' },
        status: 200,
      })

      const program = googleService.refreshToken(mockTokenData)
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
    })
  })

  describe('generateAuthUrl', () => {
    it('should generate auth URL successfully', async () => {
      const mockOAuth2Client = {
        generateAuthUrl: vi
          .fn()
          .mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?...'),
      }

      // Mock the OAuth2Client constructor to return our mock
      vi.mocked(OAuth2Client).mockImplementation(function () {
        return mockOAuth2Client as any
      })

      // Recreate service with mocked client
      googleService = makeGoogleOAuthService(mockConfig)

      const program = googleService.generateAuthUrl(
        'openid profile email',
        'state-123',
        'https://auth.example.com/callback'
      )
      const result = await Effect.runPromise(program)

      expect(result).toContain('https://accounts.google.com')
      expect(mockOAuth2Client.generateAuthUrl).toHaveBeenCalledWith({
        access_type: 'offline',
        scope: 'openid profile email',
        prompt: 'consent',
        state: 'state-123',
        response_type: 'code',
        redirect_uri: 'https://auth.example.com/callback',
      })
    })

    it('should fail when OAuth2Client is not available', async () => {
      const serviceWithoutRedirect = makeGoogleOAuthService({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        // No redirectUri
      })

      const program = serviceWithoutRedirect.generateAuthUrl(
        'openid',
        'state',
        'https://example.com/callback'
      )
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
    })
  })

  describe('refreshAccessToken', () => {
    it('should refresh access token successfully', async () => {
      const mockResponse: GoogleTokenResponse = {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile',
      }

      vi.mocked(axios.post).mockResolvedValue({
        data: mockResponse,
        status: 200,
      })

      const program = googleService.refreshAccessToken('refresh-token-123')
      const result = await Effect.runPromise(program)

      expect(result.access_token).toBe('new-access-token')
      expect(axios.post).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.any(String),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      )
      const body = new URLSearchParams(vi.mocked(axios.post).mock.calls[0][1] as string)
      expect(body.get('grant_type')).toBe('refresh_token')
      expect(body.get('refresh_token')).toBe('refresh-token-123')
      expect(body.get('client_id')).toBe('test-client-id')
      expect(body.get('client_secret')).toBe('test-client-secret')
    })

    it('should handle expired refresh token', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            error: 'invalid_grant',
            error_description: 'Token expired',
          },
        },
      }

      vi.mocked(axios.post).mockRejectedValue(axiosError)
      vi.mocked(axios.isAxiosError).mockReturnValue(true)

      const program = googleService.refreshAccessToken('expired-token')
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(GoogleAuthError)
      }
    })
  })

  describe('getUserInfo', () => {
    it('should get user info successfully', async () => {
      const mockUserInfo = {
        id: 'user-123',
        email: 'user@example.com',
        verified_email: true,
        name: 'Test User',
        given_name: 'Test',
        family_name: 'User',
        picture: 'https://example.com/photo.jpg',
      }

      vi.mocked(axios.get).mockResolvedValue({
        data: mockUserInfo,
        status: 200,
      })

      const program = googleService.getUserInfo('access-token-123', 'id-token-123')
      const result = await Effect.runPromise(program)

      expect(result.email).toBe('user@example.com')
      expect(result.id).toBe('user-123')
      expect(axios.get).toHaveBeenCalledWith(
        'https://www.googleapis.com/oauth2/v2/userinfo?alt=json&access_token=access-token-123',
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer id-token-123',
          },
        })
      )
    })

    it('should handle unauthorized access token', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 401,
          statusText: 'Unauthorized',
          data: {
            error: {
              code: 401,
              message: 'Invalid credentials',
            },
          },
        },
      }

      vi.mocked(axios.get).mockRejectedValue(axiosError)
      vi.mocked(axios.isAxiosError).mockReturnValue(true)

      const program = googleService.getUserInfo('invalid-token', 'id-token')
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        // Should be HttpStatusError since error data doesn't match GoogleError schema
        expect(result.left).toBeInstanceOf(HttpStatusError)
      }
    })

    it('should handle malformed user info response', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { invalid: 'data' },
        status: 200,
      })

      const program = googleService.getUserInfo('token', 'id-token')
      const result = await Effect.runPromise(Effect.either(program))

      expect(result._tag).toBe('Left')
    })
  })

  describe('Custom endpoints', () => {
    it('should use custom token endpoint', async () => {
      const customConfig: GoogleOAuthConfig = {
        ...mockConfig,
        tokenEndpoint: 'https://custom.example.com/token',
      }

      const customService = makeGoogleOAuthService(customConfig)

      const mockResponse: GoogleTokenResponse = {
        access_token: 'token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid',
      }

      vi.mocked(axios.post).mockResolvedValue({
        data: mockResponse,
        status: 200,
      })

      await Effect.runPromise(customService.refreshAccessToken('refresh-token'))

      expect(axios.post).toHaveBeenCalledWith(
        'https://custom.example.com/token',
        expect.any(String),
        expect.any(Object)
      )
    })

    it('should use custom user info endpoint', async () => {
      const customConfig: GoogleOAuthConfig = {
        ...mockConfig,
        userInfoEndpoint: 'https://custom.example.com/userinfo',
      }

      const customService = makeGoogleOAuthService(customConfig)

      const mockUserInfo = {
        id: 'user-123',
        email: 'user@example.com',
        verified_email: true,
      }

      vi.mocked(axios.get).mockResolvedValue({
        data: mockUserInfo,
        status: 200,
      })

      await Effect.runPromise(customService.getUserInfo('token', 'id-token'))

      expect(axios.get).toHaveBeenCalledWith(
        'https://custom.example.com/userinfo?alt=json&access_token=token',
        expect.any(Object)
      )
    })
  })
})
