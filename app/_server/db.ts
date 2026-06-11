import "server-only"

import { Pool, type PoolClient, type QueryResultRow } from "pg"

import { logger } from "@server/logger"

/**
 * Single read-only PostGIS connection pool (D-002, D-003, D-015).
 *
 * The app connects with a role that can SELECT GIS data but cannot mutate it.
 * There are no per-request credentials and no Neon branch — the connection is
 * built entirely from the DATABASE_URL_RO environment variable.
 */

const connectionString = process.env.DATABASE_URL_RO

declare global {
  // eslint-disable-next-line no-var
  var __qbPool: Pool | undefined
}

function createPool(): Pool {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL_RO is not set. Configure the read-only PostGIS connection in your environment.",
    )
  }

  const pool = new Pool({
    connectionString,
    // Keep the pool conservative for a read-only query tool.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Defense-in-depth: even if the role were writable, force read-only sessions.
    options: "-c default_transaction_read_only=on",
  })

  pool.on("error", (err) => {
    logger.error("Unexpected error on idle PostGIS client", err)
  })

  return pool
}

/**
 * Returns the shared pool, reusing it across hot reloads in development.
 */
export function getPool(): Pool {
  if (!global.__qbPool) {
    global.__qbPool = createPool()
    logger.info("Initialized read-only PostGIS pool")
  }
  return global.__qbPool
}

/**
 * Run a parameterized query against the read-only pool and return the rows.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  const pool = getPool()
  const result = await pool.query<T>(sql, params as unknown[])
  return result.rows
}

/**
 * Acquire a client for multi-statement work. Caller MUST release it.
 */
export async function getClient(): Promise<PoolClient> {
  return getPool().connect()
}

/**
 * True when the read-only connection is configured.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(connectionString)
}
