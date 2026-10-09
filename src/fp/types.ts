/**
 * Core Effect type aliases and utilities for the application
 * Using Effect instead of fp-ts for better ergonomics and features
 */
import { Effect, pipe } from 'effect';

/**
 * Type alias for effects that can fail
 * Effect<Success, Error, Requirements>
 */
export type AsyncResult<E, A> = Effect.Effect<A, E>;

/**
 * Type alias for effects with dependencies (service requirements)
 * Effect<Success, Error, Requirements>
 */
export type EffectWithDeps<R, E, A> = Effect.Effect<A, E, R>;

/**
 * Re-export commonly used Effect utilities
 */
export { Effect, pipe };

/**
 * Utility type for extracting the success type from Effect
 */
export type Unwrap<T> = T extends Effect.Effect<infer A, unknown, unknown> ? A : never;

/**
 * Utility type for extracting the error type from Effect
 */
export type UnwrapError<T> = T extends Effect.Effect<unknown, infer E, unknown> ? E : never;

/**
 * Utility type for extracting the requirements type from Effect
 */
export type UnwrapRequirements<T> = T extends Effect.Effect<unknown, unknown, infer R> ? R : never;
