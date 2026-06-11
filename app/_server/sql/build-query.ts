import "server-only"

import {
  AllowlistError,
  requireTable,
  type Allowlist,
  type TableMeta,
} from "@server/services/catalog"
import type {
  AttributeCondition,
  AttributeOperator,
  ExecuteQueryInput,
  SpatialPredicate,
} from "@shared/types"

/* -------------------------------------------------------------------------- */
/*  Parameterized SQL builder (D-007)                                          */
/*                                                                             */
/*  - Values bind as $n (never interpolated).                                  */
/*  - Geometries pass as GeoJSON via ST_GeomFromGeoJSON($n) / ST_SetSRID.      */
/*  - Identifiers (table / column / geometry column) are validated against the */
/*    allowlist, then quoted. No user string ever reaches the SQL text raw.    */
/* -------------------------------------------------------------------------- */

export interface BuiltQuery {
  sql: string // the data query (returns GeoJSON geometry + attributes)
  countSql: string // COUNT(*) over the same WHERE
  extentSql: string // ST_Extent over the same WHERE (4326)
  params: unknown[] // shared parameter array for all three statements
  displaySql: string // human-readable SQL for history/UI (params inlined as $n)
}

const DEFAULT_LIMIT = 1000
const MAX_LIMIT = 100_000

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function qualified(meta: TableMeta): string {
  return `${quoteIdent(meta.schema)}.${quoteIdent(meta.name)}`
}

/** A small helper that allocates $n placeholders into a shared params array. */
class Params {
  readonly values: unknown[] = []
  add(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }
}

/* -------------------------------------------------------------------------- */
/*  Attribute conditions                                                       */
/* -------------------------------------------------------------------------- */

const COMPARISON_OPERATORS: Partial<Record<AttributeOperator, string>> = {
  eq: "=",
  ne: "<>",
  gt: ">",
  lt: "<",
  gte: ">=",
  lte: "<=",
}

function buildAttributeCondition(
  cond: AttributeCondition,
  meta: TableMeta,
  params: Params,
): string {
  const col = meta.columns.get(cond.column)
  if (!col) {
    throw new AllowlistError(`Unknown column "${cond.column}" on table "${meta.qualified}"`)
  }
  const ident = quoteIdent(cond.column)

  switch (cond.operator) {
    case "is_null":
      return `${ident} IS NULL`
    case "not_null":
      return `${ident} IS NOT NULL`
    case "like": {
      if (typeof cond.value !== "string") {
        throw new AllowlistError(`Operator "like" requires a string value for "${cond.column}"`)
      }
      return `${ident}::text ILIKE ${params.add(cond.value)}`
    }
    case "in": {
      if (!Array.isArray(cond.value) || cond.value.length === 0) {
        throw new AllowlistError(`Operator "in" requires a non-empty array for "${cond.column}"`)
      }
      return `${ident} = ANY(${params.add(cond.value)})`
    }
    case "eq":
    case "ne":
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      if (cond.value === undefined || cond.value === null || Array.isArray(cond.value)) {
        throw new AllowlistError(
          `Operator "${cond.operator}" requires a scalar value for "${cond.column}"`,
        )
      }
      return `${ident} ${COMPARISON_OPERATORS[cond.operator]} ${params.add(cond.value)}`
    }
    default:
      throw new AllowlistError(`Unsupported operator "${String(cond.operator)}"`)
  }
}

/* -------------------------------------------------------------------------- */
/*  Spatial predicate (D-006, D-007, D-009)                                    */
/*                                                                             */
/*  The geometry column is transformed to 4326 to match the input geometry     */
/*  (drawn geometries and WKT are 4326). Distances are in meters, so DWithin    */
/*  uses a geography cast for correctness regardless of source SRID.            */
/* -------------------------------------------------------------------------- */

const SPATIAL_FUNCTIONS = new Set([
  "ST_Intersects",
  "ST_Within",
  "ST_Contains",
  "ST_DWithin",
  "ST_Buffer",
])

/** Build the input geometry expression (in 4326) from the predicate's source. */
function buildInputGeometry(
  predicate: SpatialPredicate,
  allowlist: Allowlist,
  params: Params,
): string {
  const sources = [predicate.drawnGeometry, predicate.pickedFeature, predicate.wkt].filter(
    (s) => s !== undefined,
  )
  if (sources.length !== 1) {
    throw new AllowlistError(
      "Spatial predicate must specify exactly one geometry source (drawn, picked, or wkt).",
    )
  }

  if (predicate.drawnGeometry) {
    // GeoJSON is lon/lat (4326). Pass as a JSON-encoded parameter.
    const p = params.add(JSON.stringify(predicate.drawnGeometry))
    return `ST_SetSRID(ST_GeomFromGeoJSON(${p}), 4326)`
  }

  if (predicate.wkt) {
    const p = params.add(predicate.wkt)
    return `ST_SetSRID(ST_GeomFromText(${p}), 4326)`
  }

  // Picked feature(s): resolve geometry server-side from a validated table by id,
  // unioned and transformed to 4326. Never trusts client geometry.
  const pf = predicate.pickedFeature!
  const refMeta = requireTable(allowlist, pf.table)
  if (refMeta.geometryColumn !== pf.geometryColumn) {
    throw new AllowlistError(
      `Geometry column "${pf.geometryColumn}" does not match table "${pf.table}"`,
    )
  }
  if (!refMeta.primaryKey) {
    throw new AllowlistError(`Table "${pf.table}" has no primary key to pick features by id.`)
  }
  if (!Array.isArray(pf.featureIds) || pf.featureIds.length === 0) {
    throw new AllowlistError("pickedFeature requires a non-empty featureIds array.")
  }

  const idParam = params.add(pf.featureIds)
  return `(
    SELECT ST_Transform(ST_Union(${quoteIdent(refMeta.geometryColumn)}), 4326)
    FROM ${qualified(refMeta)}
    WHERE ${quoteIdent(refMeta.primaryKey)} = ANY(${idParam})
  )`
}

function buildSpatialCondition(
  predicate: SpatialPredicate,
  meta: TableMeta,
  allowlist: Allowlist,
  params: Params,
): string {
  if (!SPATIAL_FUNCTIONS.has(predicate.operation)) {
    throw new AllowlistError(`Unsupported spatial operation "${predicate.operation}"`)
  }

  const inputGeom = buildInputGeometry(predicate, allowlist, params)
  // Geometry column transformed to 4326 to match the 4326 input geometry.
  const geomCol4326 = `ST_Transform(${quoteIdent(meta.geometryColumn)}, 4326)`

  switch (predicate.operation) {
    case "ST_Intersects":
      return `ST_Intersects(${geomCol4326}, ${inputGeom})`
    case "ST_Within":
      return `ST_Within(${geomCol4326}, ${inputGeom})`
    case "ST_Contains":
      return `ST_Contains(${geomCol4326}, ${inputGeom})`
    case "ST_DWithin": {
      const dist = predicate.distanceMeters
      if (typeof dist !== "number" || !Number.isFinite(dist) || dist < 0) {
        throw new AllowlistError("ST_DWithin requires a non-negative distanceMeters.")
      }
      // Cast to geography so the distance is in meters regardless of source CRS.
      return `ST_DWithin(${geomCol4326}::geography, ${inputGeom}::geography, ${params.add(dist)})`
    }
    case "ST_Buffer": {
      const dist = predicate.distanceMeters
      if (typeof dist !== "number" || !Number.isFinite(dist) || dist < 0) {
        throw new AllowlistError("ST_Buffer requires a non-negative distanceMeters.")
      }
      // Buffer the input geometry (meters via geography) and test intersection.
      const buffered = `ST_Buffer(${inputGeom}::geography, ${params.add(dist)})::geometry`
      return `ST_Intersects(${geomCol4326}, ${buffered})`
    }
    default:
      throw new AllowlistError(`Unsupported spatial operation "${predicate.operation}"`)
  }
}

/* -------------------------------------------------------------------------- */
/*  Top-level builder                                                          */
/* -------------------------------------------------------------------------- */

export function buildExecuteQuery(
  input: ExecuteQueryInput,
  allowlist: Allowlist,
): BuiltQuery {
  const meta = requireTable(allowlist, input.table)
  const params = new Params()

  // SELECT list: geometry as GeoJSON (4326) + validated attribute columns.
  const selectedColumns =
    input.columns.length > 0 ? input.columns : Array.from(meta.columns.keys())

  for (const c of selectedColumns) {
    if (!meta.columns.has(c)) {
      throw new AllowlistError(`Unknown column "${c}" on table "${input.table}"`)
    }
  }

  const attrSelect = selectedColumns.map((c) => quoteIdent(c)).join(", ")
  const geomCol = quoteIdent(meta.geometryColumn)
  const geojsonSelect = `ST_AsGeoJSON(ST_Transform(${geomCol}, 4326)) AS __geojson`

  // WHERE clauses (attribute + optional spatial), all parameterized.
  const whereClauses: string[] = []
  for (const cond of input.conditions ?? []) {
    whereClauses.push(buildAttributeCondition(cond, meta, params))
  }
  if (input.spatialPredicate) {
    whereClauses.push(buildSpatialCondition(input.spatialPredicate, meta, allowlist, params))
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""

  const limit = clampLimit(input.limit)
  const from = `FROM ${qualified(meta)}`

  const selectList = attrSelect ? `${geojsonSelect}, ${attrSelect}` : geojsonSelect
  const sql = `SELECT ${selectList} ${from} ${whereSql} LIMIT ${limit}`.replace(/\s+/g, " ").trim()
  const countSql = `SELECT COUNT(*)::bigint AS count ${from} ${whereSql}`
    .replace(/\s+/g, " ")
    .trim()
  const extentSql =
    `SELECT ST_Extent(ST_Transform(${geomCol}, 4326)) AS extent ${from} ${whereSql}`
      .replace(/\s+/g, " ")
      .trim()

  return {
    sql,
    countSql,
    extentSql,
    params: params.values,
    displaySql: inlineParams(sql, params.values),
  }
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT
  }
  return Math.min(Math.trunc(limit), MAX_LIMIT)
}

/** Build a display-only SQL string with parameters inlined (NOT for execution). */
function inlineParams(sql: string, params: unknown[]): string {
  return sql.replace(/\$(\d+)/g, (_, n) => {
    const value = params[Number(n) - 1]
    if (value === undefined) return `$${n}`
    if (typeof value === "number") return String(value)
    if (Array.isArray(value)) return `{${value.join(", ")}}`
    return `'${String(value).replace(/'/g, "''")}'`
  })
}
