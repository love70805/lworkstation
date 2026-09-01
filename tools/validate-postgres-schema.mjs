import { readdirSync, readFileSync } from "node:fs";
import { inspectPostgresMigration } from "../frontend/src/domain/postgresSchemaContract.js";

const migrationsUrl = new URL("../frontend/supabase/migrations/", import.meta.url);
const migrationFiles = readdirSync(migrationsUrl).filter((file) => file.endsWith(".sql")).toSorted();
const migrationSql = migrationFiles.map((file) => readFileSync(new URL(file, migrationsUrl), "utf8")).join("\n");
const result = inspectPostgresMigration(migrationSql);
if (!result.valid) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("PostgreSQL migration contract valid: tables, workspace isolation, RLS and immutable guards present.");
