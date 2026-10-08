import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import * as studentController from "./student.controller";

export const studentRouter = Router();

studentRouter.get("/", asyncHandler(studentController.listStudents));
studentRouter.get("/:id", asyncHandler(studentController.getStudent));
studentRouter.post("/", asyncHandler(studentController.createStudent));
studentRouter.put("/:id", asyncHandler(studentController.updateStudent));
studentRouter.delete("/:id", asyncHandler(studentController.deleteStudent));
