import { NextResponse } from "next/server"

import { isDatabaseConfigured } from "@server/db"
import { logger } from "@server/logger"
import { getCatalogTables } from "@server/services/catalog"
import type { CatalogTablesResponse } from "@shared/types"

/**
 * GET /api/catalog/tables — list spatial tables from geometry_columns (spec §6).
 */
export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "DATABASE_URL_RO is not configured." },
      { status: 503 },
    )
  }

  try {
    const tables = await getCatalogTables()
    const body: CatalogTablesResponse = { tables }
    return NextResponse.json(body)
  } catch (err) {
    logger.error("Failed to load catalog tables", err)
    return NextResponse.json(
      { error: "Failed to load spatial tables." },
      { status: 500 },
    )
  }
}
