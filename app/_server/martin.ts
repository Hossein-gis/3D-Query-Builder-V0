import "server-only"

import { logger } from "@server/logger"

/**
 * Server-side Martin helpers (D-004).
 *
 * Martin is a separate service that serves vector tiles (MVT) directly to the
 * browser. The Next.js backend only proxies Martin's `/catalog` so the frontend
 * has a single same-origin endpoint to discover reference layers; actual tiles
 * are fetched by MapLibre straight from `NEXT_PUBLIC_MARTIN_URL`.
 */

/** Base URL Martin is reachable at from the server (falls back to the public var). */
function martinBaseUrl(): string {
  const url =
    process.env.MARTIN_URL ?? process.env.NEXT_PUBLIC_MARTIN_URL ?? ""
  return url.replace(/\/+$/, "")
}

/**
 * A single entry in Martin's catalog. Martin's `/catalog` returns an object
 * keyed by source id; we normalize the parts we care about.
 */
export interface MartinCatalogEntry {
  id: string
  schema?: string
  table?: string
  geometryColumn?: string
  srid?: number
  geometryType?: string
  description?: string
}

export interface MartinCatalog {
  available: boolean
  baseUrl: string
  tiles: MartinCatalogEntry[]
}

interface RawMartinSource {
  schema?: string
  table?: string
  geometry_column?: string
  srid?: number
  geometry_type?: string
  description?: string
  // Martin may also nest these under `properties`
  properties?: {
    schema?: string
    table?: string
    geometry_column?: string
    srid?: number
    geometry_type?: string
  }
}

/**
 * Fetch and normalize Martin's catalog. Never throws on an unreachable Martin —
 * returns `available:false` so the UI can show a clear (Persian) empty state.
 */
export async function fetchMartinCatalog(): Promise<MartinCatalog> {
  const baseUrl = martinBaseUrl()
  if (!baseUrl) {
    logger.warn("Martin URL is not configured")
    return { available: false, baseUrl: "", tiles: [] }
  }

  try {
    const res = await fetch(`${baseUrl}/catalog`, {
      // Catalog changes rarely; let the platform cache briefly.
      next: { revalidate: 60 },
    })
    if (!res.ok) {
      logger.warn("Martin catalog responded with non-OK status", { status: res.status })
      return { available: false, baseUrl, tiles: [] }
    }

    const body = (await res.json()) as { tiles?: Record<string, RawMartinSource> }
    const rawTiles = body.tiles ?? {}

    const tiles: MartinCatalogEntry[] = Object.entries(rawTiles).map(([id, src]) => {
      const p = src.properties ?? {}
      return {
        id,
        schema: src.schema ?? p.schema,
        table: src.table ?? p.table,
        geometryColumn: src.geometry_column ?? p.geometry_column,
        srid: src.srid ?? p.srid,
        geometryType: src.geometry_type ?? p.geometry_type,
        description: src.description,
      }
    })

    tiles.sort((a, b) => a.id.localeCompare(b.id))
    return { available: true, baseUrl, tiles }
  } catch (err) {
    logger.warn("Failed to reach Martin catalog", {
      error: err instanceof Error ? err.message : String(err),
    })
    return { available: false, baseUrl, tiles: [] }
  }
}
