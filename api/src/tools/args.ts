import { z } from "zod";

/** Argumentos que comparten las herramientas del motor y las del chat. */

export const MensajeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "solo letras, números, '-' y '_'")
  .describe("Id del mensaje del buzón, p. ej. msg-001");
