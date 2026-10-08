import type { Request, Response } from "express";
import {
  createStudentSchema,
  listStudentsQuerySchema,
  studentIdSchema,
  updateStudentSchema,
} from "./student.schema";
import * as studentService from "./student.service";

export async function createStudent(req: Request, res: Response): Promise<void> {
  const input = createStudentSchema.parse(req.body);
  const student = await studentService.createStudent(input);
  res.status(201).json({ data: student });
}

export async function listStudents(req: Request, res: Response): Promise<void> {
  const query = listStudentsQuerySchema.parse(req.query);
  const result = await studentService.listStudents(query);
  res.json(result);
}

export async function getStudent(req: Request, res: Response): Promise<void> {
  const { id } = studentIdSchema.parse(req.params);
  const student = await studentService.getStudent(id);
  res.json({ data: student });
}

export async function updateStudent(req: Request, res: Response): Promise<void> {
  const { id } = studentIdSchema.parse(req.params);
  const input = updateStudentSchema.parse(req.body);
  const student = await studentService.updateStudent(id, input);
  res.json({ data: student });
}

export async function deleteStudent(req: Request, res: Response): Promise<void> {
  const { id } = studentIdSchema.parse(req.params);
  await studentService.removeStudent(id);
  res.status(204).send();
}
