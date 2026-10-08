import { pool } from "./pool";

const schemaSql = `
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  date_of_birth DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS students_created_at_idx ON students (created_at DESC);
`;

export async function ensureSchema(): Promise<void> {
  await pool.query(schemaSql);
}
