/**
 * Pure validation functions using Effect for error handling
 */
import crypto from 'crypto'
import { Effect, Schema, ParseResult, pipe } from 'effect'
import {
  InvalidPKCE,
  InvalidScope,
  RequiredFieldMissing,
  InvalidFormat,
  SchemaValidationError,
  ClientExistsError,
} from './errors.js'
import type { PKCEMethod } from './domain.js'

/**
 * Validate schema and return Effect
 */
export const validateSchema = <A, I>(
  schema: Schema.Schema<A, I, never>,
  value: unknown
): Effect.Effect<A, SchemaValidationError> =>
  pipe(
    Schema.decodeUnknown(schema)(value),
    Effect.mapError(
      (error) =>
        new SchemaValidationError({
          errors: ParseResult.ArrayFormatter.formatErrorSync(error).map((e) => e.message),
          value,
        })
    )
  )

/**
 * Pure PKCE validation function
 * Takes a code_verifier, challenge, and method and returns Effect
 */
export const validatePKCE = (
  verifier: string,
  challenge: string,
  method: PKCEMethod
): Effect.Effect<true, InvalidPKCE> =>
  Effect.try({
    try: () => {
      let computedChallenge: string

      if (method === 'S256') {
        computedChallenge = crypto.createHash('sha256').update(verifier).digest('base64url')
      } else if (method === 'plain') {
        computedChallenge = verifier
      } else {
        throw new Error(`Unknown method: ${method}`)
      }

      if (computedChallenge === challenge) {
        return true as const
      } else {
        throw new Error(`Challenge mismatch: expected ${challenge}, got ${computedChallenge}`)
      }
    },
    catch: (error) =>
      new InvalidPKCE({
        challenge,
        verifier,
        method: String(error),
      }),
  })
/**
 * Ensure the client doesn't exists in the clients table
 */
export const validateCreateClient = (
  clientId: string,
  clients: string[]
): Effect.Effect<true, ClientExistsError> => {
  return clients.includes(clientId)
    ? Effect.fail(new ClientExistsError({ clientId, clients }))
    : Effect.succeed(true as const)
}
/**
 * Validate OAuth2 scopes
 * Ensures all requested scopes are within the granted scopes
 */
export const validateScopes = (
  requestedScopes: string[],
  grantedScopes: string[]
): Effect.Effect<true, InvalidScope> => {
  const hasAllScopes = requestedScopes.every((s) => grantedScopes.includes(s))

  return hasAllScopes
    ? Effect.succeed(true as const)
    : Effect.fail(new InvalidScope({ requested: requestedScopes, granted: grantedScopes }))
}

/**
 * Parse space-separated scope string into array
 */
export const parseScopeString = (scope: string): string[] => {
  return scope.split(' ').filter((s) => s.length > 0)
}

/**
 * Validate required field exists
 */
export const validateRequired = <T>(
  field: string,
  value: T | null | undefined
): Effect.Effect<T, RequiredFieldMissing> => {
  return value != null ? Effect.succeed(value) : Effect.fail(new RequiredFieldMissing({ field }))
}

/**
 * Validate that a value is not empty string
 */
export const validateNonEmpty = (
  field: string,
  value: string
): Effect.Effect<string, InvalidFormat> => {
  return value.trim().length > 0
    ? Effect.succeed(value)
    : Effect.fail(
        new InvalidFormat({
          field,
          expected: 'non-empty string',
          received: value,
        })
      )
}

/**
 * Collect all validations
 * Runs all validations in parallel
 */
export const validateAll = <E, A>(validations: Effect.Effect<A, E>[]): Effect.Effect<A[], E> =>
  Effect.all(validations, { concurrency: 'unbounded' })
