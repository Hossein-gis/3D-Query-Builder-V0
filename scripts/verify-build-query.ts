import { buildExecuteQuery } from "../app/_server/sql/build-query"
import type { Allowlist, TableMeta } from "../app/_server/services/catalog"

// Synthetic allowlist (no DB needed) to verify D-007 guarantees.
const parcels: TableMeta = {
  schema: "public",
  name: "parcels",
  qualified: "public.parcels",
  geometryColumn: "geom",
  srid: 32639,
  geometryType: "MULTIPOLYGON",
  primaryKey: "id",
  columns: new Map([
    ["id", { name: "id", type: "integer" }],
    ["owner", { name: "owner", type: "text" }],
    ["area", { name: "area", type: "numeric" }],
  ]),
}
const allowlist: Allowlist = new Map([["public.parcels", parcels]])

let failures = 0
function check(label: string, cond: boolean) {
  if (!cond) {
    failures++
    console.error(`FAIL: ${label}`)
  } else {
    console.log(`ok: ${label}`)
  }
}

// 1. Attribute + spatial predicate → parameterized, no raw values in SQL.
const built = buildExecuteQuery(
  {
    table: "public.parcels",
    geometryColumn: "geom",
    srid: 32639,
    columns: ["owner", "area"],
    conditions: [{ column: "owner", operator: "eq", value: "Ali" }],
    spatialPredicate: {
      operation: "ST_Intersects",
      drawnGeometry: { type: "Point", coordinates: [52.5, 29.6] },
    },
  },
  allowlist,
)
check("uses $1 binding for attribute value", built.sql.includes("$1"))
check("attribute value is NOT inlined in sql", !built.sql.includes("Ali"))
check("value present in params", built.params.includes("Ali"))
check("geometry uses ST_GeomFromGeoJSON", built.sql.includes("ST_GeomFromGeoJSON"))
check("geometry transformed to 4326", built.sql.includes("ST_Transform"))
check("countSql produced", built.countSql.includes("COUNT(*)"))
check("extentSql produced", built.extentSql.includes("ST_Extent"))
check("displaySql inlines value", built.displaySql.includes("'Ali'"))

// 2. Unknown table is rejected.
try {
  buildExecuteQuery(
    { table: "public.secret", geometryColumn: "geom", srid: 4326, columns: [], conditions: [] },
    allowlist,
  )
  check("unknown table rejected", false)
} catch {
  check("unknown table rejected", true)
}

// 3. Unknown column is rejected.
try {
  buildExecuteQuery(
    {
      table: "public.parcels",
      geometryColumn: "geom",
      srid: 32639,
      columns: [],
      conditions: [{ column: "password; DROP TABLE x", operator: "eq", value: "x" }],
    },
    allowlist,
  )
  check("unknown/injection column rejected", false)
} catch {
  check("unknown/injection column rejected", true)
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
