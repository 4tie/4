import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const defaultDbName = "we";
const defaultDbUser = process.env.PGUSER || process.env.USER || "postgres";
const defaultDatabaseUrl = `postgresql://${encodeURIComponent(defaultDbUser)}@/${defaultDbName}?host=/var/run/postgresql`;
const databaseUrl = process.env.DATABASE_URL || defaultDatabaseUrl;

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle(pool, { schema });
