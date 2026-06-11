import "server-only"

import { query } from "@server/db"
import { logger } from "@server/logger"
import { loadAllowlist } from "@server/services/catalog"
import { buildExecuteQuery } from "@server/sql/build-query"
import type { BBox, ExecuteQueryInput, ExecuteQueryResponse } from "@shared/types"

/**
 * Execute a query and return GeoJSON (D-005 default branch).
 *
 * The tile branch (rowCount > MARTIN_RESULT_TILE_THRESHOLD) is Phase 4; in this
 * phase a large result still returns GeoJSON up to the query LIMIT.
 */
export async function executeQuery(
  input: ExecuteQueryInput,
): Promise<ExecuteQueryResponse> {
  const allowlist = await loadAllowlist()
  const built = buildExecuteQuery(input, allowlist)

  logger.debug("Executing query", { table: input.table, sql: built.displaySql })

  // Row count over the full WHERE (independent of LIMIT).
  const countRows = await query<{ count: string }>(built.countSql, built.params)
  const rowCount = Number(countRows[0]?.count ?? 0)

  // Extent (4326) for zoom-to.
  const extentRows = await query<{ extent: string | null }>(built.extentSql, built.params)
  const bbox = parseBox2D(extentRows[0]?.extent ?? null)

  // Data rows: geometry as GeoJSON + attributes.
  const dataRows = await query<Record<string, unknown> & { __geojson: string | null }>(
    built.sql,
    built.params,
  )

  const features: GeoJSON.Feature[] = []
  dataRows.forEach((row, index) => {
    const { __geojson, ...properties } = row
    if (!__geojson) return // skip rows with no/empty geometry
    features.push({
      type: "Feature",
      id: index,
      geometry: JSON.parse(__geojson) as GeoJSON.Geometry,
      properties: properties as GeoJSON.GeoJsonProperties,
    })
  })

  const geojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features,
  }

  return {
    render: { mode: "geojson", geojson },
    rowCount,
    bbox,
    sql: built.displaySql,
  }
}

/**
 * Parse a PostGIS `BOX(minx miny,maxx maxy)` string into a 4326 bbox tuple.
 */
function parseBox2D(box: string | null): BBox | null {
  if (!box) return null
  const match = box.match(
    /BOX\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i,
  )
  if (!match) return null
  const [, minX, minY, maxX, maxY] = match
  return [Number(minX), Number(minY), Number(maxX), Number(maxY)]
}
