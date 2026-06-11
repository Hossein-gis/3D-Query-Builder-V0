import { NextResponse } from "next/server"

import { isDatabaseConfigured } from "@server/db"
import { logger } from "@server/logger"
import { AllowlistError } from "@server/services/catalog"
import { executeQuery } from "@server/services/execute-query"
import type { ExecuteQueryInput } from "@shared/types"

/**
 * POST /api/query/execute — run a parameterized attribute + spatial query (spec §6).
 *
 * Phase 1: GeoJSON branch only. The large-result tile branch (D-005) is Phase 4.
 */
export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "DATABASE_URL_RO is not configured." },
      { status: 503 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const validationError = validateInput(body)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  try {
    const result = await executeQuery(body as ExecuteQueryInput)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AllowlistError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    logger.error("Query execution failed", err)
    return NextResponse.json({ error: "Query execution failed." }, { status: 500 })
  }
}

/** Lightweight shape validation; deep identifier validation happens in the builder. */
function validateInput(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return "Request body must be an object."
  }
  const b = body as Record<string, unknown>
  if (typeof b.table !== "string" || b.table.length === 0) {
    return "'table' is required."
  }
  if (typeof b.geometryColumn !== "string" || b.geometryColumn.length === 0) {
    return "'geometryColumn' is required."
  }
  if (typeof b.srid !== "number") {
    return "'srid' is required and must be a number."
  }
  if (!Array.isArray(b.columns)) {
    return "'columns' must be an array (use [] for all columns)."
  }
  if (!Array.isArray(b.conditions)) {
    return "'conditions' must be an array (use [] for none)."
  }
  return null
}
