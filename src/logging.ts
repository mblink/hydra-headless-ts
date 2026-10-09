/**
 * @deprecated This file has been replaced by logging-effect.ts
 *
 * All logging now uses Effect's Logger with file output to rotating log stream.
 *
 * Migration:
 * - For Effect code: Use Effect.logInfo, Effect.logError, etc. (already configured)
 * - For Express/non-Effect code: Use syncLogger from './logging-effect.js'
 *
 * Example:
 * ```typescript
 * import { syncLogger } from './logging-effect.js'
 *
 * syncLogger.info('Message', { key: 'value' })
 * syncLogger.error('Error message', { error: err })
 * ```
 */

// Re-export for backwards compatibility
export { syncLogger as default, accessLogStream } from './logging-effect.js';
