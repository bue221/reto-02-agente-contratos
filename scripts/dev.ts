/**
 * `bun run dev`: backend (con recarga) + front Vite en paralelo. Si uno termina, se detiene el otro.
 * Backend en PORT (3000 por defecto); Vite en 5173 con proxy de /api hacia el backend.
 */
import { join } from "node:path";
import type { Subprocess } from "bun";

const raiz = join(import.meta.dir, "..");
const puerto = process.env.PORT ?? "3000";

const procesos: Subprocess[] = [
  Bun.spawn(["bun", "--watch", "src/server.ts"], { cwd: raiz, env: { ...process.env, PORT: puerto }, stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["bun", "run", "dev"], { cwd: join(raiz, "web"), env: { ...process.env, PORT: puerto }, stdout: "inherit", stderr: "inherit" }),
];

console.info(`[dev] backend http://localhost:${puerto} · front http://localhost:5173`);

function detenerTodo(codigo: number): never {
  for (const proceso of procesos) proceso.kill();
  process.exit(codigo);
}

process.on("SIGINT", () => detenerTodo(0));
process.on("SIGTERM", () => detenerTodo(0));

const primero = await Promise.race(procesos.map((proceso) => proceso.exited));
console.error(`[dev] un proceso terminó con código ${primero}; deteniendo el resto`);
detenerTodo(primero || 1);
