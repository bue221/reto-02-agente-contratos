import { AppError } from "../domain/errors.ts";

export { AppError as ApiError } from "../domain/errors.ts";

export function toErrorBody(err: unknown): {
  error: string;
  code: string;
  status: number;
  details?: Record<string, unknown>;
} {
  if (err instanceof AppError) {
    return { error: err.message, code: err.code, status: err.status, details: err.details };
  }
  const message = err instanceof Error ? err.message : "Error interno";
  console.error("[api]", err);
  return { error: message, code: "INTERNAL", status: 500 };
}
