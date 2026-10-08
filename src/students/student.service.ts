import { randomUUID } from "crypto";
import { AppError, isUniqueViolation } from "../errors/AppError";
import * as studentRepository from "./student.repository";
import type {
  CreateStudentInput,
  ListStudentsQuery,
  Student,
  StudentList,
  UpdateStudentInput,
} from "./student.types";

export async function createStudent(input: CreateStudentInput): Promise<Student> {
  try {
    return await studentRepository.insertStudent(randomUUID(), input);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, "A student with this email already exists");
    }

    throw error;
  }
}

export async function getStudent(id: string): Promise<Student> {
  const student = await studentRepository.findStudentById(id);

  if (!student) {
    throw new AppError(404, "Student not found");
  }

  return student;
}

export async function listStudents(query: ListStudentsQuery): Promise<StudentList> {
  const { students, total } = await studentRepository.listStudents(query);

  return {
    data: students,
    pagination: {
      limit: query.limit,
      offset: query.offset,
      total,
    },
  };
}

export async function updateStudent(id: string, input: UpdateStudentInput): Promise<Student> {
  try {
    const student = await studentRepository.updateStudent(id, input);

    if (!student) {
      throw new AppError(404, "Student not found");
    }

    return student;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, "A student with this email already exists");
    }

    throw error;
  }
}

export async function removeStudent(id: string): Promise<void> {
  const deleted = await studentRepository.deleteStudent(id);

  if (!deleted) {
    throw new AppError(404, "Student not found");
  }
}
