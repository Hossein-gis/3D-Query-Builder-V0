// Shared API contracts and data models — imported by BOTH the backend (app/_server)
// and the frontend. TYPES ONLY: no runtime code, no server-only imports, no React.
// See query-builder-spec.md §5 and §6.

import type { Geometry } from "geojson"

/* -------------------------------------------------------------------------- */
/*  Catalog                                                                    */
/* -------------------------------------------------------------------------- */

export interface AttributeColumn {
  name: string
  type: string
}

export interface SpatialTable {
  schema: string
  name: string
  geometryColumn: string
  srid: number
  geometryType: string
  attributeColumns: AttributeColumn[]
}

export interface CatalogTablesResponse {
  tables: SpatialTable[]
}

export interface CatalogDistinctResponse {
  values: Array<string | number>
}

/* -------------------------------------------------------------------------- */
/*  Martin reference layers (D-004)                                            */
/* -------------------------------------------------------------------------- */

export interface MartinLayer {
  id: string // Martin source id, e.g. "public.roads"
  schema?: string
  table?: string
  geometryColumn?: string
  srid?: number
  geometryType?: string
  description?: string
}

export interface MartinCatalogResponse {
  available: boolean
  baseUrl: string
  layers: MartinLayer[]
}

/* -------------------------------------------------------------------------- */
/*  Query building                                                             */
/* -------------------------------------------------------------------------- */

export type AttributeOperator =
  | "eq"
  | "ne"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "like"
  | "in"
  | "is_null"
  | "not_null"

export interface AttributeCondition {
  column: string
  operator: AttributeOperator
  value?: string | number | boolean | Array<string | number>
}

export type SpatialOperation =
  | "ST_Intersects"
  | "ST_Within"
  | "ST_Contains"
  | "ST_DWithin"
  | "ST_Buffer"

export interface SpatialPredicate {
  operation: SpatialOperation
  // geometry source — exactly one of:
  drawnGeometry?: Geometry // from draw tools (lon/lat, 4326)
  pickedFeature?: {
    table: string
    geometryColumn: string
    featureIds: Array<string | number>
  }
  wkt?: string // advanced
  distanceMeters?: number // for ST_DWithin / ST_Buffer
}

export interface ExecuteQueryInput {
  table: string // schema-qualified, e.g. "public.parcels"
  geometryColumn: string
  srid: number
  columns: string[] // selected attribute columns ([] = all)
  conditions: AttributeCondition[]
  spatialPredicate?: SpatialPredicate
  limit?: number // default 1000
}

/* -------------------------------------------------------------------------- */
/*  Query execution result                                                     */
/* -------------------------------------------------------------------------- */

export type BBox = [number, number, number, number] // 4326

export type RenderDescriptor =
  | { mode: "geojson"; geojson: GeoJSON.FeatureCollection }
  | { mode: "tiles"; resultSetId: string; tileUrl: string }

export interface ExecuteQueryResponse {
  render: RenderDescriptor
  rowCount: number
  bbox: BBox | null
  sql: string // for display only
}

/* -------------------------------------------------------------------------- */
/*  Search history (localStorage)                                              */
/* -------------------------------------------------------------------------- */

export interface SearchHistoryEntry {
  id: string // uuid
  name: string // user-editable; default auto-generated
  createdAt: string // ISO
  table: string // schema-qualified, e.g. "public.parcels"
  geometryColumn: string
  srid: number // source SRID
  columns: string[] // selected attribute columns ([] = all)
  conditions: AttributeCondition[]
  spatialPredicate?: SpatialPredicate
  generatedSql: string // for display only
  rowCount: number
  bbox: BBox // 4326, for zoom-to
  render: { mode: "geojson" } | { mode: "tiles"; resultSetId: string }
  color: string // hex from palette
  visible: boolean
}

/* -------------------------------------------------------------------------- */
/*  Generic API error shape                                                    */
/* -------------------------------------------------------------------------- */

export interface ApiError {
  error: string
}
