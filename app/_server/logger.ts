import "server-only"

/**
 * Minimal structured logger for server-side code.
 * Replaces scattered console.log("[v0] ...") calls with a single consistent API.
 */

type Level = "debug" | "info" | "warn" | "error"

function emit(level: Level, message: string, meta?: unknown) {
  const prefix = `[qb:${level}]`
  if (meta !== undefined) {
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](prefix, message, meta)
  } else {
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](prefix, message)
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => emit("debug", message, meta),
  info: (message: string, meta?: unknown) => emit("info", message, meta),
  warn: (message: string, meta?: unknown) => emit("warn", message, meta),
  error: (message: string, meta?: unknown) => emit("error", message, meta),
}
