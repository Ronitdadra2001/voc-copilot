import type { Analysis } from "./types";

/** Dual-mode data layer: SQLite locally (no cloud DB needed for `next dev`),
 * Neon/Vercel Postgres in production (Vercel's serverless functions have no
 * persistent local filesystem, so a SQLite file on disk would not reliably
 * survive between invocations). Selected automatically by whether a
 * Postgres connection string is present — nothing to configure locally. */
const POSTGRES_URL =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
const usePostgres = Boolean(POSTGRES_URL);

export interface InsertAnalysisInput {
  id: string;
  company_name: string;
  direction: string;
  raw_reviews: string;
  competitor_context: string | null;
  financial_context: string | null;
  result_json: string;
}

// ===== SQLite (local dev) =====

let sqliteDb: import("better-sqlite3").Database | null = null;

function getSqliteDb() {
  if (sqliteDb) return sqliteDb;
  // Lazy + dynamic require: keeps better-sqlite3 out of the bundle path
  // entirely when POSTGRES_URL is set (production), since Vercel's build
  // environment does not need to compile its native binding at all.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs");

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const db = new Database(path.join(dataDir, "voc.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('competitor', 'own')),
      raw_reviews TEXT NOT NULL,
      competitor_context TEXT,
      financial_context TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  sqliteDb = db;
  return db;
}

// ===== Postgres / Neon (production on Vercel) =====

let neonSql: ReturnType<typeof import("@neondatabase/serverless").neon> | null = null;
let postgresReady: Promise<void> | null = null;

function getNeonSql(): NonNullable<typeof neonSql> {
  if (!neonSql) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { neon } = require("@neondatabase/serverless");
    neonSql = neon(POSTGRES_URL as string);
  }
  return neonSql!;
}

async function ensurePostgresSchema(): Promise<void> {
  if (!postgresReady) {
    const sql = getNeonSql();
    postgresReady = sql`
      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        company_name TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('competitor', 'own')),
        raw_reviews TEXT NOT NULL,
        competitor_context TEXT,
        financial_context TEXT,
        result_json TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.then(() => undefined);
  }
  return postgresReady;
}

// ===== Public async API =====

export async function insertAnalysis(input: InsertAnalysisInput): Promise<void> {
  if (usePostgres) {
    await ensurePostgresSchema();
    const sql = getNeonSql();
    await sql`
      INSERT INTO analyses
        (id, company_name, direction, raw_reviews, competitor_context, financial_context, result_json)
      VALUES
        (${input.id}, ${input.company_name}, ${input.direction}, ${input.raw_reviews},
         ${input.competitor_context}, ${input.financial_context}, ${input.result_json})
    `;
    return;
  }
  const db = getSqliteDb();
  db.prepare(
    `INSERT INTO analyses (id, company_name, direction, raw_reviews, competitor_context, financial_context, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.company_name,
    input.direction,
    input.raw_reviews,
    input.competitor_context,
    input.financial_context,
    input.result_json
  );
}

export async function getAnalysisById(id: string): Promise<Analysis | undefined> {
  if (usePostgres) {
    await ensurePostgresSchema();
    const sql = getNeonSql();
    const rows = (await sql`SELECT * FROM analyses WHERE id = ${id}`) as Analysis[];
    return rows[0];
  }
  const db = getSqliteDb();
  return db.prepare(`SELECT * FROM analyses WHERE id = ?`).get(id) as Analysis | undefined;
}
