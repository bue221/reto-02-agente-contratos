/**
 * Error de aplicación con código estable para el frontend.
 * `details` viaja al cliente (p.ej. motivos de un bloqueo por reglas).
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}
