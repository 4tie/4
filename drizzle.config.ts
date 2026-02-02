import "./env";
import { defineConfig } from "drizzle-kit";

const defaultDbName = "we";
const defaultDbUser = process.env.PGUSER || process.env.USER || "postgres";
const defaultDatabaseUrl = `postgresql://${encodeURIComponent(defaultDbUser)}@/${defaultDbName}?host=/var/run/postgresql`;
const databaseUrl = process.env.DATABASE_URL || defaultDatabaseUrl;

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
