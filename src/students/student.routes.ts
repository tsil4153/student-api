import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { jsonBody } from "../middleware/jsonBody";
import type { AuthConfig } from "../config";
import { requireAdmin } from "../auth/requireAdmin";
import * as studentController from "./student.controller";

export function createStudentRouter(auth: AuthConfig): Router {
	const router = Router();

	router.get("/", asyncHandler(studentController.listStudents));
	router.get("/:id", asyncHandler(studentController.getStudent));
	router.post("/", requireAdmin(auth), jsonBody, asyncHandler(studentController.createStudent));
	router.put("/:id", requireAdmin(auth), jsonBody, asyncHandler(studentController.updateStudent));
	router.delete("/:id", requireAdmin(auth), asyncHandler(studentController.deleteStudent));

	return router;
}
