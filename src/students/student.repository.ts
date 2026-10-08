import { pool } from "../db/pool";
import type {
  CreateStudentInput,
  ListStudentsQuery,
  Student,
  StudentRow,
  UpdateStudentInput,
} from "./student.types";

const studentColumns = `
  id,
  first_name,
  last_name,
  email,
  date_of_birth,
  created_at,
  updated_at
`;

const columnByField = {
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  dateOfBirth: "date_of_birth",
} as const;

export async function insertStudent(id: string, input: CreateStudentInput): Promise<Student> {
  const result = await pool.query<StudentRow>(
    `
      INSERT INTO students (id, first_name, last_name, email, date_of_birth)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING ${studentColumns}
    `,
    [id, input.firstName, input.lastName, input.email, input.dateOfBirth ?? null],
  );

  return mapStudent(result.rows[0]);
}

export async function findStudentById(id: string): Promise<Student | null> {
  const result = await pool.query<StudentRow>(
    `SELECT ${studentColumns} FROM students WHERE id = $1`,
    [id],
  );

  return result.rows[0] ? mapStudent(result.rows[0]) : null;
}

export async function listStudents(
  query: ListStudentsQuery,
): Promise<{ students: Student[]; total: number }> {
  const [studentsResult, countResult] = await Promise.all([
    pool.query<StudentRow>(
      `
        SELECT ${studentColumns}
        FROM students
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `,
      [query.limit, query.offset],
    ),
    pool.query<{ total: number }>("SELECT COUNT(*)::int AS total FROM students"),
  ]);

  return {
    students: studentsResult.rows.map(mapStudent),
    total: countResult.rows[0]?.total ?? 0,
  };
}

export async function updateStudent(
  id: string,
  input: UpdateStudentInput,
): Promise<Student | null> {
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const field of Object.keys(columnByField) as Array<keyof typeof columnByField>) {
    if (input[field] !== undefined) {
      values.push(input[field]);
      assignments.push(`${columnByField[field]} = $${values.length}`);
    }
  }

  assignments.push("updated_at = NOW()");
  values.push(id);

  const result = await pool.query<StudentRow>(
    `
      UPDATE students
      SET ${assignments.join(", ")}
      WHERE id = $${values.length}
      RETURNING ${studentColumns}
    `,
    values,
  );

  return result.rows[0] ? mapStudent(result.rows[0]) : null;
}

export async function deleteStudent(id: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM students WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

function mapStudent(row: StudentRow): Student {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    dateOfBirth: toDateOnly(row.date_of_birth),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toDateOnly(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
