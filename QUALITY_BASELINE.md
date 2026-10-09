# Code Quality Baseline

This document summarizes the code quality infrastructure established for the hydra-headless-ts project.

## Overview

A comprehensive baseline has been established covering:

- ✅ Unit and integration testing
- ✅ TypeScript linting
- ✅ Code formatting
- ✅ Type checking
- ✅ Automated validation

## Testing Infrastructure

### Framework: Vitest 3.2.4
- Fast, modern test runner with Effect integration
- 116 baseline tests covering core functionality
- 90% passing rate (105/116 tests)

### Test Coverage

**Test Files Created**:

1. `src/fp/config.test.ts` (12 tests) - Configuration service with environment handling
2. `src/fp/domain.test.ts` (34 tests) - Schema validation for all domain types
3. `src/fp/services/redis.test.ts` (28 tests) - Redis operations and OAuth storage
4. `src/fp/services/hydra.test.ts` (13 tests) - Hydra OAuth2 API integration
5. `src/fp/services/google.test.ts` (15 tests) - Google OAuth operations
6. `src/fp/bootstrap.test.ts` (14 tests) - Service layer composition

**Coverage Areas**:

- Effect Config validation and defaults
- Effect Schema runtime validation
- Service error handling (HttpError, RedisError, GoogleAuthError)
- Layer composition and dependency injection
- Integration between services
- Mock-based unit testing

### Test Scripts

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode for development
npm run test:ui       # Interactive UI
npm run test:coverage # Generate coverage report
```

## Linting Infrastructure

### Tools Installed

**Core**:

- ESLint 10.x (flat config format)
- @typescript-eslint/parser
- @typescript-eslint/eslint-plugin

**Plugins**:

- eslint-plugin-import-x - Import order and organization
- eslint-plugin-promise - Promise best practices
- eslint-plugin-functional - FP patterns

### Configuration

**File**: `eslint.config.js` (ESLint 9 flat config)

**Key Rules**:

- TypeScript strict mode compatible
- Import order enforcement
- Prefer nullish coalescing (??)
- Type-only imports
- No floating promises
- Functional programming patterns

**Relaxed for Tests**:

- Allow `any` types in tests
- Allow console statements
- Allow non-null assertions

### Linting Scripts

```bash
npm run lint          # Check for linting issues
npm run lint:fix      # Auto-fix linting issues
```

## Formatting Infrastructure

### Tool: Prettier

**Configuration**: `.prettierrc.json`

**Settings**:

- Single quotes
- Semicolons
- 120 character line width
- 2 space indentation
- Trailing commas everywhere (`all`)
- Objects keep their written wrapping (`objectWrap: "preserve"`)

### Formatting Scripts

```bash
npm run format        # Format all source files
npm run format:check  # Check formatting without fixing
```

## Type Checking

### TypeScript Compiler

**Configuration**: `tsconfig.json`

**Scripts**:

```bash
npm run typecheck     # Run TypeScript type checking
```

## Combined Validation

### All-in-One Check

```bash
npm run validate      # Runs: typecheck → lint → test
```

This single command ensures:

1. ✅ TypeScript compiles without errors
2. ✅ Code passes all linting rules
3. ✅ All tests pass

## CI/CD Integration

`RC` is tested and built by Woodpecker (`.woodpecker.yml`), which runs `npm run ci` and then builds the Docker image with `npm run build`. Lint warnings, formatting, unused code (knip), type errors and Rollup warnings all fail both; see [What fails CI and the build](LINTING.md#what-fails-ci-and-the-build).

## Pre-Commit Workflow

Recommended workflow before committing:

```bash
# 1. Format code
npm run format

# 2. Fix linting issues
npm run lint:fix

# 3. Full validation
npm run validate

# 4. Commit
git add .
git commit -m "feat: description"
```

## Package.json Scripts Summary

### Development

- `start:local` - Dev mode with local.env
- `start:staging` - Dev mode with staging.env
- `start:production` - Dev mode with production.env

### Building

- `build` - Full build (clean + compile + bundle)
- `clean` - Remove build artifacts
- `typecheck` - TypeScript type checking

### Testing

- `test` - Run tests once
- `test:watch` - Watch mode
- `test:ui` - Interactive UI
- `test:coverage` - Coverage report

### Linting & Formatting

- `lint` - Check linting
- `lint:fix` - Auto-fix linting
- `format` - Format code
- `format:check` - Check formatting

### Validation

- `validate` - Run typecheck + lint + test

## File Structure

```text
hydra-headless-ts/
├── vitest.config.ts          # Test configuration
├── eslint.config.js          # ESLint configuration (flat config)
├── .prettierrc.json          # Prettier configuration
├── .prettierignore           # Prettier ignore patterns
├── tsconfig.json             # TypeScript configuration
├── DEVELOPMENT.md            # Development guide
├── LINTING.md                # Linting documentation
├── README.test.md            # Testing documentation
└── src/
    ├── fp/
    │   ├── *.test.ts         # Test files co-located with source
    │   ├── config.ts
    │   ├── domain.ts
    │   └── services/
    └── env/
        ├── local.env
        ├── staging.env
        └── production.env
```

## Quality Metrics

### Current Baseline

**Tests**: 105/116 passing (90%)

- Config tests: All environment scenarios covered
- Domain tests: All schemas validated
- Service tests: Core operations tested
- Integration tests: Layer composition verified

**Linting**:

- ~100 warnings (mostly import order, easily fixable)
- 0 errors blocking development
- All functional programming patterns recognized

**Type Safety**:

- Strict TypeScript mode
- Effect types properly inferred
- Schema validation at runtime

## Future Improvements

1. **Test Coverage**: Address remaining 11 failing tests
   - Mock adjustment for Google OAuth client
   - Type compatibility for Hydra client versions
   - Fix test expectation mismatches

2. **Linting**: Auto-fix import order warnings

   ```bash
   npm run lint:fix
   ```

3. **Coverage Goals**: Aim for 95%+ test coverage

   ```bash
   npm run test:coverage
   ```

4. **CI/CD**: Add GitHub Actions workflow
5. **Pre-commit Hooks**: Add husky for automated checks

## Benefits

This quality baseline provides:

1. **Regression Protection** - Tests catch breaking changes
2. **Consistent Code Style** - Prettier enforces formatting
3. **Type Safety** - TypeScript + ESLint catch errors
4. **Developer Experience** - Fast feedback with watch modes
5. **Documentation** - Tests serve as living documentation
6. **Confidence** - Safe refactoring with test coverage

## Maintenance

### Keep Dependencies Updated

```bash
npm outdated
npm update
```

### Review Test Coverage

```bash
npm run test:coverage
```

### Fix Linting Warnings

```bash
npm run lint:fix
npm run format
```

## Resources

- [DEVELOPMENT.md](DEVELOPMENT.md) - Complete development guide
- [LINTING.md](LINTING.md) - Linting details and customization
- [README.test.md](README.test.md) - Testing guide and patterns
- [Effect Documentation](https://effect.website/)
- [Vitest Documentation](https://vitest.dev/)
- [ESLint Documentation](https://eslint.org/)

---

**Established**: 2025-01-04
**Status**: ✅ Baseline Complete
**Next Steps**: Address remaining test failures, add CI/CD pipeline
