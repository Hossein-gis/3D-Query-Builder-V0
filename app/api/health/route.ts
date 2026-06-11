import { NextResponse } from "next/server"

import { isDatabaseConfigured, query } from "@server/db"
import { logger } from "@server/logger"

/**
 * Phase 0 health check (temporary).
 * Verifies the read-only pool can reach PostGIS via env config only.
 */
export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "DATABASE_URL_RO is not configured. Set it to your read-only PostGIS connection string.",
      },
      { status: 503 },
    )
  }

  try {
    const rows = await query<{ result: number }>("SELECT 1 AS result")
    return NextResponse.json({ ok: true, result: rows[0]?.result ?? null })
  } catch (err) {
    logger.error("Health check failed", err)
    return NextResponse.json(
      { ok: false, error: "Failed to reach PostGIS through the read-only pool." },
      { status: 500 },
    )
  }
}
