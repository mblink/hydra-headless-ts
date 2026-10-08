/**
 * Domain types with Effect Schema for runtime validation
 * Using Effect Schema provides both compile-time types and runtime validation
 */
import { Schema } from 'effect'

/**
 * PKCE Challenge Method
 */
export const PKCEMethodSchema = Schema.Literal('S256', 'plain')
export type PKCEMethod = typeof PKCEMethodSchema.Type

/**
 * PKCE State stored in Redis
 */
export const PKCEStateSchema = Schema.Struct({
  code_challenge: Schema.String,
  code_challenge_method: PKCEMethodSchema,
  scope: Schema.String,
  state: Schema.String,
  redirect_uri: Schema.String,
  client_id: Schema.String,
  timestamp: Schema.Number,
})
export type PKCEState = typeof PKCEStateSchema.Type

/**
 * OAuth2 Grant Types
 */
export const GrantTypeSchema = Schema.Literal('authorization_code', 'refresh_token')

/**
 * Authorization Code Grant Request
 */
export const AuthCodeGrantSchema = Schema.Struct({
  grant_type: Schema.Literal('authorization_code'),
  code: Schema.String,
  code_verifier: Schema.String,
  redirect_uri: Schema.String,
  client_id: Schema.String,
})
export type AuthCodeGrant = typeof AuthCodeGrantSchema.Type

/**
 * Refresh Token Grant Request
 */
export const RefreshTokenGrantSchema = Schema.Struct({
  grant_type: Schema.Literal('refresh_token'),
  refresh_token: Schema.String,
  client_id: Schema.String,
  scope: Schema.optional(Schema.String),
})
export type RefreshTokenGrant = typeof RefreshTokenGrantSchema.Type

/**
 * Token Request (discriminated union)
 */
export const TokenRequestSchema = Schema.Union(AuthCodeGrantSchema, RefreshTokenGrantSchema)

/**
 * Google Token Response
 */
export const GoogleTokenResponseSchema = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number,
  scope: Schema.String,
  token_type: Schema.String,
  id_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
})
export type GoogleTokenResponse = typeof GoogleTokenResponseSchema.Type
export const GoogleUserInfoSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  verified_email: Schema.Boolean,
  name: Schema.optional(Schema.String),
  given_name: Schema.optional(Schema.String),
  family_name: Schema.optional(Schema.String),
  picture: Schema.optional(Schema.String),
  locale: Schema.optional(Schema.String),
})

export type GoogleUserInfoResponse = typeof GoogleUserInfoSchema.Type

/**
 * Google Error Response
 */
export const GoogleErrorResponseSchema = Schema.Struct({
  error: Schema.String,
  error_description: Schema.optional(Schema.String),
})

/**
 * Google Token Data stored in Redis (indexed by JTI)
 * This stores the actual Google OAuth tokens we need to make API calls
 */
export const GoogleTokenDataSchema = Schema.Struct({
  google_access_token: Schema.String,
  google_refresh_token: Schema.String,
  google_id_token: Schema.optional(Schema.String),
  scope: Schema.String,
  subject: Schema.String,
  client_id: Schema.String,
  expires_at: Schema.Number, // Unix timestamp when Google token expires
  updated_at: Schema.Number,
})
export type GoogleTokenData = typeof GoogleTokenDataSchema.Type

/**
 * JWT Refresh Token Data stored in Redis (indexed by our refresh_token)
 * This maps our refresh token to the JTI of the access token
 */
export const JWTRefreshDataSchema = Schema.Struct({
  jti: Schema.String, // Current access token's JTI
  client_id: Schema.String,
  scope: Schema.String,
  subject: Schema.String,
  created_at: Schema.Number,
})
export type JWTRefreshData = typeof JWTRefreshDataSchema.Type

/**
 * Legacy Refresh Token Data stored in Redis (for backward compatibility)
 * @deprecated Use GoogleTokenDataSchema and JWTRefreshDataSchema instead
 */
const RefreshTokenDataSchema = Schema.Struct({
  client_id: Schema.String,
  refresh_token: Schema.String,
  access_token: Schema.String,
  scope: Schema.String,
  subject: Schema.String,
  created_at: Schema.Number,
  expires_in: Schema.Number,
  updated_at: Schema.optional(Schema.Number),
})
export type RefreshTokenData = typeof RefreshTokenDataSchema.Type

/**
 * Auth Code Data stored in Redis
 */
export const AuthCodeDataSchema = Schema.Struct({
  google_tokens: Schema.Struct({
    tokens: GoogleTokenResponseSchema,
  }),
  subject: Schema.optional(Schema.String),
  // Absolute expiry of the Google access token (ms since epoch). Optional so auth codes
  // issued before this field existed can still be exchanged.
  google_expires_at: Schema.optional(Schema.Number),
})
export type AuthCodeData = typeof AuthCodeDataSchema.Type

/**
 * OAuth2 Token Response (what we return to clients)
 */
const OAuth2TokenResponseSchema = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.Literal('Bearer'),
  expires_in: Schema.Number,
  refresh_token: Schema.String,
  scope: Schema.String,
})
export type OAuth2TokenResponse = typeof OAuth2TokenResponseSchema.Type

/**
 * OAuth2 Error Response
 */
const OAuth2ErrorResponseSchema = Schema.Struct({
  error: Schema.String,
  error_description: Schema.optional(Schema.String),
})
export type OAuth2ErrorResponse = typeof OAuth2ErrorResponseSchema.Type

/**
 * Helper to create OAuth2 error responses
 */
export const createOAuth2Error = (
  error: string,
  errorDescription?: string
): OAuth2ErrorResponse => ({
  error,
  error_description: errorDescription,
})
