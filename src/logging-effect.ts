/**
 * Unified Effect-based logging with file output
 * Replaces jsonLogger with Effect's Logger while maintaining file output
 */
import { Effect, Logger, Layer, LogLevel } from 'effect'
import { createStream } from 'rotating-file-stream'
import { logDirConfig } from './fp/config.js'
/**
 * Rotating file stream for persistent logs
 * Rotates daily, compresses old logs
 */
export const accessLogStream = createStream('hydra-headless.log', {
  interval: '1d',
  path: Effect.runSync(logDirConfig),
  compress: 'gzip',
})

/**
 * Custom Effect logger that writes to both stdout and rotating file
 * Maintains same JSON format as previous jsonLogger for compatibility
 */
export const customLogger = Logger.make<unknown, void>(
  ({ logLevel, message, annotations, spans, fiberId, date }) => {
    // Convert annotations HashMap to plain object
    const annotationsObj: Record<string, unknown> = {}

    for (const [key, value] of annotations) {
      annotationsObj[key] = value
    }

    // Convert spans to object
    const spansObj: Record<string, unknown> = {}
    for (const span of spans) {
      spansObj[span.label] = span
    }

    // Get fiberId as string
    const fiberIdStr = String(fiberId)

    const entry = {
      message: String(message),
      logLevel: logLevel.label,
      timestamp: date.toISOString(),
      annotations: annotationsObj,
      spans: spansObj,
      fiberId: fiberIdStr,
    }

    const json = JSON.stringify(entry)

    // Write to both stdout and file
    process.stdout.write(`${json}\n`)
    accessLogStream.write(`${json}\n`)
  }
)

/**
 * Create logger layer for Effect runtime
 * Replaces Logger.json with custom file-writing logger
 */
export const createLoggerLayer = () => Logger.replace(Logger.defaultLogger, customLogger)

/**
 * Synchronous logging helper for non-Effect code
 * Writes directly to stdout and file without running Effect
 */
export const logSync = (
  level: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL',
  message: string,
  annotations?: Record<string, unknown>
) => {
  const entry = {
    message,
    logLevel: level,
    timestamp: new Date().toISOString(),
    annotations: annotations ?? {},
    spans: {},
    fiberId: '#sync',
  }

  const json = JSON.stringify(entry)
  process.stdout.write(`${json}\n`)
  accessLogStream.write(`${json}\n`)
}

/**
 * Convenience methods for synchronous logging
 */
export const syncLogger = {
  trace: (message: string, annotations?: Record<string, unknown>) =>
    logSync('TRACE', message, annotations),
  debug: (message: string, annotations?: Record<string, unknown>) =>
    logSync('DEBUG', message, annotations),
  info: (message: string, annotations?: Record<string, unknown>) =>
    logSync('INFO', message, annotations),
  warn: (message: string, annotations?: Record<string, unknown>) =>
    logSync('WARN', message, annotations),
  error: (message: string, annotations?: Record<string, unknown>) =>
    logSync('ERROR', message, annotations),
  fatal: (message: string, annotations?: Record<string, unknown>) =>
    logSync('FATAL', message, annotations),
}
