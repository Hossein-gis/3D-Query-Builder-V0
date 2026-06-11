import "server-only"

import { query } from "@server/db"
import { logger } from "@server/logger"
import type {
  AttributeColumn,
  CatalogDistinctResponse,
  SpatialTable,
} from "@shared/types"

/* -------------------------------------------------------------------------- */
/*  Allowlist (D-007, D-008)                                                   */
/*                                                                             */
/*  Derived from PostGIS `geometry_columns` + `information_schema.columns`.    */
/*  Every table / column / geometry-column name used in generated SQL is       */
/*  validated against this allowlist before it is quoted into a statement.     */
/* -------------------------------------------------------------------------- */

export interface TableMeta {
  schema: string
  name: string
  qualified: string // "schema.name"
  geometryColumn: string
  srid: number
  geometryType: string
  columns: Map<string, AttributeColumn> // attribute columns (excludes geometry)
  primaryKey?: string
}

export type Allowlist = Map<string, TableMeta>

interface GeometryColumnRow {
  f_table_schema: string
  f_table_name: string
  f_geometry_column: string
  srid: number
  type: string
}

interface ColumnRow {
  table_schema: string
  table_name: string
  column_name: string
  data_type: string
}

interface PrimaryKeyRow {
  table_schema: string
  table_name: string
  column_name: string
}

let cachedAllowlist: Allowlist | null = null

/**
 * Load (and cache per process) the set of spatial tables and their columns.
 * Pass `force` to rebuild the cache.
 */
export async function loadAllowlist(force = false): Promise<Allowlist> {
  if (cachedAllowlist && !force) {
    return cachedAllowlist
  }

  // 1. Spatial tables from PostGIS geometry_columns.
  const geomRows = await query<GeometryColumnRow>(
    `SELECT f_table_schema, f_table_name, f_geometry_column, srid, type
     FROM geometry_columns`,
  )

  const allowlist: Allowlist = new Map()

  for (const g of geomRows) {
    const qualified = `${g.f_table_schema}.${g.f_table_name}`
    allowlist.set(qualified, {
      schema: g.f_table_schema,
      name: g.f_table_name,
      qualified,
      geometryColumn: g.f_geometry_column,
      srid: g.srid,
      geometryType: g.type,
      columns: new Map(),
    })
  }

  if (allowlist.size === 0) {
    cachedAllowlist = allowlist
    logger.warn("Allowlist is empty: no rows in geometry_columns")
    return allowlist
  }

  const schemas = Array.from(new Set(Array.from(allowlist.values()).map((t) => t.schema)))
  const names = Array.from(new Set(Array.from(allowlist.values()).map((t) => t.name)))

  // 2. Attribute columns from information_schema.columns (geometry columns excluded below).
  const colRows = await query<ColumnRow>(
    `SELECT table_schema, table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = ANY($1) AND table_name = ANY($2)`,
    [schemas, names],
  )

  for (const c of colRows) {
    const meta = allowlist.get(`${c.table_schema}.${c.table_name}`)
    if (!meta) continue
    if (c.column_name === meta.geometryColumn) continue // never expose geometry as attribute
    meta.columns.set(c.column_name, { name: c.column_name, type: c.data_type })
  }

  // 3. Primary keys (used to resolve picked features by id).
  const pkRows = await query<PrimaryKeyRow>(
    `SELECT kcu.table_schema, kcu.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema = ANY($1)
       AND tc.table_name = ANY($2)`,
    [schemas, names],
  )

  for (const pk of pkRows) {
    const meta = allowlist.get(`${pk.table_schema}.${pk.table_name}`)
    if (meta && !meta.primaryKey) {
      meta.primaryKey = pk.column_name
    }
  }

  cachedAllowlist = allowlist
  logger.info("Loaded spatial table allowlist", { tables: allowlist.size })
  return allowlist
}

/** Resolve a table from the allowlist or throw a clear error. */
export function requireTable(allowlist: Allowlist, table: string): TableMeta {
  const meta = allowlist.get(table)
  if (!meta) {
    throw new AllowlistError(`Unknown or non-spatial table: "${table}"`)
  }
  return meta
}

/** Error type for allowlist / identifier validation failures (maps to HTTP 400). */
export class AllowlistError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AllowlistError"
  }
}

/* -------------------------------------------------------------------------- */
/*  Catalog responses (spec §6)                                                */
/* -------------------------------------------------------------------------- */

export async function getCatalogTables(): Promise<SpatialTable[]> {
  const allowlist = await loadAllowlist()
  return Array.from(allowlist.values())
    .map((t) => ({
      schema: t.schema,
      name: t.name,
      geometryColumn: t.geometryColumn,
      srid: t.srid,
      geometryType: t.geometryType,
      attributeColumns: Array.from(t.columns.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    }))
    .sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`))
}

/** Quote a SQL identifier (only ever called with allowlist-validated names). */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Distinct values for a single column (capped). Table + column are validated
 * against the allowlist before identifiers are quoted into the statement.
 */
export async function getDistinctValues(
  table: string,
  column: string,
  cap = 500,
): Promise<CatalogDistinctResponse> {
  const allowlist = await loadAllowlist()
  const meta = requireTable(allowlist, table)
  if (!meta.columns.has(column)) {
    throw new AllowlistError(`Unknown column "${column}" on table "${table}"`)
  }

  const sql = `SELECT DISTINCT ${quoteIdent(column)} AS value
     FROM ${quoteIdent(meta.schema)}.${quoteIdent(meta.name)}
     WHERE ${quoteIdent(column)} IS NOT NULL
     ORDER BY 1
     LIMIT ${Math.trunc(cap)}`

  const rows = await query<{ value: string | number }>(sql)
  return { values: rows.map((r) => r.value) }
}
