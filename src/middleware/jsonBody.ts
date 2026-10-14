import express from "express";

export const jsonBody = express.json({ limit: "1mb" });