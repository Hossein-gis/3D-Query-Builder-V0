import { NextResponse } from "next/server"

import { isDatabaseConfigured } from "@server/db"
import { logger } from "@server/logger"
import { AllowlistError, getDistinctValues } from "@server/services/catalog"

/**
 * GET /api/catalog/distinct?table=&column= — distinct values for a column (spec §6).
 */
export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "DATABASE_URL_RO is not configured." },
      { status: 503 },
    )
  }

  const { searchParams } = new URL(request.url)
  const table = searchParams.get("table")
  const column = searchParams.get("column")

  if (!table || !column) {
    return NextResponse.json(
      { error: "Both 'table' and 'column' query parameters are required." },
      { status: 400 },
    )
  }

  try {
    const result = await getDistinctValues(table, column)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AllowlistError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    logger.error("Failed to load distinct values", err)
    return NextResponse.json(
      { error: "Failed to load distinct values." },
      { status: 500 },
    )
  }
}
