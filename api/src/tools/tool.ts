import { z } from "zod";
import { registrarLog } from "../infrastructure/logs.ts";
import { type Rutas, rutasDelProyecto } from "../infrastructure/paths.ts";
import { type Resultado, fallo, mensajeDeError } from "../core/domain/result.ts";

export interface ContextoHerramienta {
  /** Raíz del proyecto: todas las rutas se resuelven desde aquí. */
  directory: string;
  sessionId: string;
  /** Fecha de registro inyectable (YYYY-MM-DD) para que la demo y los tests sean deterministas. */
  hoy?: string;
}

/** Forma que exige el PRD 6.2. `execute` nunca lanza y siempre devuelve `{ ok, data | error }` serializado. */
export interface Herramienta<A extends z.ZodRawShape> {
  description: string;
  args: A;
  execute(args: z.input<z.ZodObject<A>>, ctx: ContextoHerramienta): Promise<string>;
}

/** Vista sin tipos concretos para el registro y el ciclo del agente (argumentos crudos del modelo). */
export interface HerramientaGenerica {
  description: string;
  args: Readonly<Record<string, z.ZodType>>;
  execute(args: unknown, ctx: ContextoHerramienta): Promise<string>;
}

interface Definicion<A extends z.ZodRawShape, T> {
  nombre: string;
  description: string;
  args: A;
  ejecutar(args: z.output<z.ZodObject<A>>, ctx: ContextoHerramienta, rutas: Rutas): Promise<Resultado<T>>;
  resumir(data: T): string;
}

export const describirErroresZod = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.map(String).join(".") || "(raíz)"}: ${issue.message}`).join("; ");

const mensajeIdDe = (args: unknown): string | null =>
  typeof args === "object" && args !== null && "mensaje_id" in args && typeof args.mensaje_id === "string" ? args.mensaje_id : null;

async function ejecutarSinLanzar<T>(accion: () => Promise<Resultado<T>>): Promise<Resultado<T>> {
  try {
    return await accion();
  } catch (error) {
    return fallo(mensajeDeError(error));
  }
}

/** RN7/CA4: el log no debe tumbar la herramienta; si falla se reporta por stderr. */
async function registrarLogSinLanzar(rutas: Rutas, herramienta: string, args: unknown, resumen: string, ok: boolean): Promise<void> {
  try {
    await registrarLog(rutas, { herramienta, mensaje_id: mensajeIdDe(args), ok, resumen });
  } catch (error) {
    console.error(`[log] no se pudo escribir out/log.jsonl: ${mensajeDeError(error)}`);
  }
}

/** Resumen legible por herramienta, fuera del objeto para respetar los tres miembros del contrato (PRD 6.2). */
const resumidores = new WeakMap<object, (json: string) => string>();

/** Mismo resumen que va a `out/log.jsonl`, para mostrar la llamada en el chat (CA4). */
export function resumirResultado(herramienta: HerramientaGenerica, json: string): string {
  const resumir = resumidores.get(herramienta);
  if (resumir) return resumir(json);
  return json.slice(0, 200);
}

/** Valida argumentos con zod, ejecuta sin lanzar y deja traza en `out/log.jsonl` (un solo punto: DRY). */
export function definirHerramienta<A extends z.ZodRawShape, T>(definicion: Definicion<A, T>): Herramienta<A> {
  const esquema = z.object(definicion.args);
  const herramienta: Herramienta<A> = {
    description: definicion.description,
    args: definicion.args,
    async execute(args, ctx) {
      const rutas = rutasDelProyecto(ctx.directory);
      const validados = esquema.safeParse(args ?? {});
      const resultado = validados.success
        ? await ejecutarSinLanzar(() => definicion.ejecutar(validados.data, ctx, rutas))
        : fallo<T>(`argumentos inválidos: ${describirErroresZod(validados.error)}`);
      const resumen = resultado.ok ? definicion.resumir(resultado.data) : resultado.error;
      await registrarLogSinLanzar(rutas, definicion.nombre, args, resumen, resultado.ok);
      return JSON.stringify(resultado);
    },
  };
  resumidores.set(herramienta, (json) => {
    // El JSON lo produjo esta misma herramienta: su forma es Resultado<T>.
    const resultado = JSON.parse(json) as Resultado<T>;
    return resultado.ok ? definicion.resumir(resultado.data) : resultado.error;
  });
  return herramienta;
}

export async function herramientaDesconocida(nombre: string, ctx: ContextoHerramienta, disponibles: string[]): Promise<string> {
  const error = `herramienta desconocida: "${nombre}" (disponibles: ${disponibles.join(", ")})`;
  await registrarLogSinLanzar(rutasDelProyecto(ctx.directory), nombre, null, error, false);
  return JSON.stringify(fallo(error));
}
