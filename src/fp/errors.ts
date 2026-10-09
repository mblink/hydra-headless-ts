/**
 * Application error types using Effect's Data module for tagged errors
 * Each error is a discriminated union for exhaustive pattern matching
 */
import { Data } from 'effect'

/**
 * Redis operation errors
 */
export class RedisConnectionError extends Data.TaggedError('RedisConnectionError')<{
  message: string
}> {}

export class RedisKeyNotFound extends Data.TaggedError('RedisKeyNotFound')<{
  key: string
}> {}

export class RedisParseError extends Data.TaggedError('RedisParseError')<{
  key: string
  raw: string
  error: unknown
}> {}

export class RedisWriteError extends Data.TaggedError('RedisWriteError')<{
  key: string
  error: unknown
}> {}

export class RedisDeleteError extends Data.TaggedError('RedisDeleteError')<{
  key: string
  error: unknown
}> {}

export type RedisError =
  RedisConnectionError | RedisKeyNotFound | RedisParseError | RedisWriteError | RedisDeleteError

/**
 * HTTP client errors
 */
export class NetworkError extends Data.TaggedError('NetworkError')<{
  message: string
  cause?: unknown
}> {}

export class HttpStatusError extends Data.TaggedError('HttpStatusError')<{
  status: number
  statusText: string
  body?: unknown
}> {}

export class ParseError extends Data.TaggedError('ParseError')<{
  message: string
  raw?: string
}> {}

export type HttpError = NetworkError | HttpStatusError | ParseError

/**
 * OAuth2/PKCE validation errors
 */
export class InvalidPKCE extends Data.TaggedError('InvalidPKCE')<{
  challenge: string
  verifier: string
  method: string
}> {}

export class InvalidGrant extends Data.TaggedError('InvalidGrant')<{
  reason: string
}> {}

export class InvalidScope extends Data.TaggedError('InvalidScope')<{
  requested: string[]
  granted: string[]
}> {}

export class MissingParameter extends Data.TaggedError('MissingParameter')<{
  parameter: string
}> {}

type OAuthError = InvalidPKCE | InvalidGrant | InvalidScope | MissingParameter

/**
 * Google OAuth errors
 */
export class GoogleAuthError extends Data.TaggedError('GoogleAuthError')<{
  error: string
  errorDescription?: string
}> {}

/**
 * Validation errors
 */
export class SchemaValidationError extends Data.TaggedError('SchemaValidationError')<{
  errors: string[]
  value: unknown
}> {}

export class RequiredFieldMissing extends Data.TaggedError('RequiredFieldMissing')<{
  field: string
}> {}

export class InvalidFormat extends Data.TaggedError('InvalidFormat')<{
  field: string
  expected: string
  received: unknown
}> {}
export class ClientExistsError extends Data.TaggedError('ClientExists')<{
  clientId: string
  clients: string[]
}> {}
type ValidationError =
  SchemaValidationError | RequiredFieldMissing | InvalidFormat | ClientExistsError

/**
 * Application-level errors (union of all domain errors)
 */
export type AppError = RedisError | HttpError | OAuthError | GoogleAuthError | ValidationError
