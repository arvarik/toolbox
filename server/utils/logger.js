/**
 * @fileoverview Zero-dependency structured JSON logger.
 * Outputs standard NDJSON (Newline Delimited JSON) to stdout/stderr.
 */

const LEVELS = {
  DEBUG: { value: 10, name: 'DEBUG' },
  INFO:  { value: 20, name: 'INFO' },
  WARN:  { value: 30, name: 'WARN' },
  ERROR: { value: 40, name: 'ERROR' }
}

const CURRENT_LEVEL = process.env.LOG_LEVEL 
  ? LEVELS[process.env.LOG_LEVEL.toUpperCase()] || LEVELS.INFO
  : LEVELS.INFO

function log(level, message, meta = {}) {
  if (level.value < CURRENT_LEVEL.value) return

  const entry = {
    timestamp: new Date().toISOString(),
    level: level.name,
    message,
    ...meta
  }

  const output = JSON.stringify(entry)
  
  if (level.value >= LEVELS.ERROR.value) {
    process.stderr.write(output + '\n')
  } else {
    process.stdout.write(output + '\n')
  }
}

export const logger = {
  debug: (msg, meta) => log(LEVELS.DEBUG, msg, meta),
  info:  (msg, meta) => log(LEVELS.INFO,  msg, meta),
  warn:  (msg, meta) => log(LEVELS.WARN,  msg, meta),
  error: (msg, meta) => log(LEVELS.ERROR, msg, meta)
}

export default logger
