import crypto from 'crypto';
import { Effect, Schema } from 'effect';
import { describe, it, expect } from 'vitest';
import {
  ClientExistsError,
  InvalidFormat,
  InvalidPKCE,
  InvalidScope,
  RequiredFieldMissing,
  SchemaValidationError,
} from './errors.js';
import {
  parseScopeString,
  validateAll,
  validateCreateClient,
  validateNonEmpty,
  validatePKCE,
  validateRequired,
  validateSchema,
  validateScopes,
} from './validation.js';

const runEither = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.either(effect));

describe('fp/validation', () => {
  describe('validatePKCE', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    // RFC 7636 Appendix B test vector
    const s256Challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    it('accepts a matching S256 challenge (RFC 7636 vector)', async () => {
      const result = await Effect.runPromise(validatePKCE(verifier, s256Challenge, 'S256'));
      expect(result).toBe(true);
    });

    it('accepts a computed S256 challenge for a random verifier', async () => {
      const v = crypto.randomBytes(32).toString('base64url');
      const c = crypto.createHash('sha256').update(v).digest('base64url');
      await expect(Effect.runPromise(validatePKCE(v, c, 'S256'))).resolves.toBe(true);
    });

    it('rejects a mismatched S256 challenge', async () => {
      const result = await runEither(validatePKCE('wrong-verifier', s256Challenge, 'S256'));
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(InvalidPKCE);
        expect(result.left.challenge).toBe(s256Challenge);
      }
    });

    it('does not accept the raw verifier as an S256 challenge', async () => {
      const result = await runEither(validatePKCE(verifier, verifier, 'S256'));
      expect(result._tag).toBe('Left');
    });

    it('accepts plain when verifier equals challenge', async () => {
      await expect(Effect.runPromise(validatePKCE('abc', 'abc', 'plain'))).resolves.toBe(true);
    });

    it('rejects plain when verifier differs', async () => {
      const result = await runEither(validatePKCE('abc', 'abd', 'plain'));
      expect(result._tag).toBe('Left');
    });

    it('rejects an unknown method', async () => {
      const result = await runEither(validatePKCE('abc', 'abc', 'S512' as never));
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.method).toContain('Unknown method');
      }
    });
  });

  describe('validateScopes', () => {
    it('succeeds when requested scopes are a subset of granted', async () => {
      await expect(
        Effect.runPromise(validateScopes(['openid', 'email'], ['openid', 'email', 'profile'])),
      ).resolves.toBe(true);
    });

    it('succeeds for an empty request', async () => {
      await expect(Effect.runPromise(validateScopes([], ['openid']))).resolves.toBe(true);
    });

    it('fails when a requested scope was not granted', async () => {
      const result = await runEither(validateScopes(['openid', 'admin'], ['openid']));
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(InvalidScope);
        expect(result.left.requested).toEqual(['openid', 'admin']);
        expect(result.left.granted).toEqual(['openid']);
      }
    });
  });

  describe('parseScopeString', () => {
    it('splits on spaces and drops empty entries', () => {
      expect(parseScopeString('openid  email profile ')).toEqual(['openid', 'email', 'profile']);
    });

    it('returns an empty array for an empty string', () => {
      expect(parseScopeString('')).toEqual([]);
    });
  });

  describe('validateRequired', () => {
    it('passes through defined values, including falsy ones', async () => {
      await expect(Effect.runPromise(validateRequired('n', 0))).resolves.toBe(0);
      await expect(Effect.runPromise(validateRequired('s', ''))).resolves.toBe('');
    });

    it.each([null, undefined])('fails for %s', async (value) => {
      const result = await runEither(validateRequired('code', value));
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(RequiredFieldMissing);
        expect(result.left.field).toBe('code');
      }
    });
  });

  describe('validateNonEmpty', () => {
    it('accepts non-blank strings', async () => {
      await expect(Effect.runPromise(validateNonEmpty('f', ' x '))).resolves.toBe(' x ');
    });

    it('rejects whitespace-only strings', async () => {
      const result = await runEither(validateNonEmpty('f', '   '));
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(InvalidFormat);
      }
    });
  });

  describe('validateCreateClient', () => {
    it('succeeds for a new client id', async () => {
      await expect(Effect.runPromise(validateCreateClient('new', ['a', 'b']))).resolves.toBe(true);
    });

    it('fails for an existing client id', async () => {
      const result = await runEither(validateCreateClient('a', ['a', 'b']));
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ClientExistsError);
      }
    });
  });

  describe('validateSchema', () => {
    const PersonSchema = Schema.Struct({
      name: Schema.String,
      age: Schema.Number,
    });

    it('decodes valid input', async () => {
      await expect(Effect.runPromise(validateSchema(PersonSchema, { name: 'a', age: 1 }))).resolves.toEqual({
        name: 'a',
        age: 1,
      });
    });

    it('returns SchemaValidationError with messages and the original value', async () => {
      const input = { name: 'a' };
      const result = await runEither(validateSchema(PersonSchema, input));
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(SchemaValidationError);
        expect(result.left.errors.length).toBeGreaterThan(0);
        expect(result.left.value).toBe(input);
      }
    });
  });

  describe('validateAll', () => {
    it('collects all successes', async () => {
      await expect(Effect.runPromise(validateAll([Effect.succeed(1), Effect.succeed(2)]))).resolves.toEqual([1, 2]);
    });

    it('fails if any validation fails', async () => {
      const result = await runEither(validateAll([validateNonEmpty('a', 'x'), validateNonEmpty('b', '')]));
      expect(result._tag).toBe('Left');
    });
  });
});
