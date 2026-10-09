# Linting and Code Quality

This project follows TypeScript and functional programming best practices with comprehensive linting and formatting tools.

## Tools

### ESLint

- **Version**: ESLint 10.x (flat config format)
- **Parser**: @typescript-eslint/parser
- **Plugins**:
  - `@typescript-eslint/eslint-plugin` - TypeScript-specific linting rules
  - `eslint-plugin-import-x` - Import/export syntax and order
  - `eslint-plugin-promise` - Promise best practices
  - `eslint-plugin-functional` - Functional programming patterns

### Prettier

- **Configuration**: `.prettierrc.json`
- **Settings**:
  - Single quotes
  - Semicolons
  - Trailing commas everywhere (`trailingComma: "all"`)
  - 120 character line width
  - Objects keep the wrapping they were written with (`objectWrap: "preserve"`)
  - 2 space indentation

## Scripts

### Linting

```bash
# Run linter
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```

### Formatting

```bash
# Format all source files
npm run format

# Check formatting without fixing
npm run format:check
```

### Type Checking

```bash
# Run TypeScript compiler checks
npm run typecheck
```

### Combined Validation

```bash
# Run typecheck, lint, and tests
npm run validate
```

## ESLint Configuration

The ESLint configuration ([eslint.config.js](eslint.config.js)) is structured for Effect-based functional programming:

### Key Rules

`npm run lint` runs with `--max-warnings 0`, so a rule set to `warn` fails lint just like `error`.

**TypeScript**:

- `@typescript-eslint/no-explicit-any`: warn - Discourage `any` types
- `@typescript-eslint/no-unused-vars`: warn - Flag unused variables (ignores `_` prefix)
- `@typescript-eslint/consistent-type-imports`: warn - Prefer `import type` for types
- `@typescript-eslint/no-floating-promises`: error - Ensure promises are handled
- `@typescript-eslint/await-thenable`: error - Only await actual promises
- `@typescript-eslint/prefer-nullish-coalescing`: warn - Use `??` over `||`
- `@typescript-eslint/prefer-optional-chain`: warn - Use optional chaining

**Code Quality**:

- `no-console`: warn (allow `console.warn` and `console.error`)
- `prefer-const`: error - Use const when possible
- `no-var`: error - No var declarations
- `eqeqeq`: error - Always use === and !==
- `prefer-template`: warn - Use template literals

**Imports**:

- `import/order`: warn - Enforce import order (builtin → external → internal)
- `import/no-duplicates`: error - No duplicate imports
- `import/no-cycle`: warn - Detect circular dependencies

**Functional Programming**:

- `functional/no-loop-statements`: warn - Prefer map/filter/reduce
- `functional/no-let`: off - Effect patterns may need let
- `functional/no-throw-statements`: off - Effect handles errors differently

### Test Files

Test files (`*.test.ts`, `*.spec.ts`) have relaxed rules:

- `any` types allowed
- Non-null assertions allowed
- Console statements allowed
- Floating promises allowed

## Import Order

Imports should be ordered as:

1. Node.js built-ins (e.g., `path`, `fs`)
2. External dependencies (e.g., `effect`, `express`)
3. Internal modules (e.g., `./services/redis`)
4. Type imports (e.g., `import type { User } from './types'`)

Example:

```typescript
import path from 'path'
import { Effect, Layer } from 'effect'
import express from 'express'
import { RedisService } from './services/redis.js'
import type { AppConfig } from './config.js'
```

## Ignored Files

The following are automatically ignored:

- `dist/` - Build output
- `lib/` - Package output
- `node_modules/` - Dependencies
- `coverage/` - Test coverage reports
- `*.config.js` - Config files

## Pre-Commit Workflow

Recommended workflow before committing:

```bash
# 1. Format code
npm run format

# 2. Fix auto-fixable lint issues
npm run lint:fix

# 3. Run full validation
npm run validate
```

This ensures:

- ✅ Code is properly formatted
- ✅ No linting errors
- ✅ TypeScript compiles without errors
- ✅ All tests pass

## What fails CI and the build

- `npm run ci` (Woodpecker's test step on `RC`) runs `clean`, `lint`, `format:check`, `knip`, `tsc` and the tests.
- `npm run build` (run by the Docker image build) runs `clean`, `lint`, `format:check`, `knip`, `tsc` and Rollup.

Any lint error or warning, unformatted file, unused file, export or dependency (knip) or type error fails both. `npm run format` and `npm run lint:fix` fix most of them.

### Rollup warnings

Rollup's `onwarn` in `rollup.config.js` turns every warning into a build failure. Fix the cause rather than allowlisting it. Unresolved-import warnings matter most: Rollup otherwise treats the import as external, so the build succeeds and the server fails at runtime. Only add a warning code to the allowlist when it comes from a bundled dependency under `node_modules`; the two allowed today are `THIS_IS_UNDEFINED` (TypeScript helpers in `@ory/hydra-client-fetch`) and `CIRCULAR_DEPENDENCY` (`pg` and `pg-pool` import each other).

## Customization

### Adding Rules

Edit [eslint.config.js](eslint.config.js) to add or modify rules:

```javascript
rules: {
  'your-rule': 'error',
  '@typescript-eslint/your-rule': 'warn',
}
```

### Disabling Rules

For specific lines:

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data: any = legacyFunction()
```

For entire files:

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
// File content
```

## Effect-Specific Patterns

The linting setup recognizes Effect patterns:

✅ **Allowed**:

```typescript
const program = Effect.gen(function* () {
  const result = yield* someEffect
  return result
})
```

✅ **Encouraged**:

```typescript
import type { Redis } from 'ioredis'  // Type-only import
import { Effect } from 'effect'        // Value import
```

⚠️ **Discouraged**:

```typescript
const data: any = {}  // Use specific types
result || fallback    // Use ?? for nullish coalescing
```

## Resources

- [ESLint Documentation](https://eslint.org/docs/latest/)
- [TypeScript ESLint](https://typescript-eslint.io/)
- [Effect Documentation](https://effect.website/)
- [Prettier](https://prettier.io/)
