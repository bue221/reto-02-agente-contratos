import { leerConfiguracion } from "../../api/src/config.ts";
import type { ClasificadorDeAlcance } from "../../api/src/agent/guardrails/input-guard.ts";
import { crearClasificador } from "../../api/src/agent/guardrails/scope-classifier.ts";
import type { LimitesCiclo } from "../../api/src/agent/turn.ts";
import { crearProveedor } from "../../api/src/llm/factory.ts";
import type { ProveedorLlm } from "../../api/src/llm/adapter.ts";

/**
 * Lo que comparten los grafos de Studio con la app: la misma raíz del proyecto (mismo `out/`, así lo que
 * se haga en Studio aparece en el buzón y la bandeja), el mismo proveedor, los mismos topes y las mismas guardas elegidas por entorno.
 */

export interface DependenciasStudio {
  /** Raíz del proyecto: `ctx.directory` de las herramientas. */
  directorio: string;
  proveedor: ProveedorLlm;
  /** Los de la app: iteraciones por turno (CA1) y tokens por hilo y por proceso. */
  limites: LimitesCiclo;
  /** Por defecto `agent/prompt.md` + conocimiento, leídos en cada turno como en la app. */
  cargarSistema?: () => Promise<string>;
  /** Clasificador de alcance de la guarda de entrada; sin él solo rigen las reglas deterministas. */
  clasificador?: ClasificadorDeAlcance | undefined;
}

export function dependenciasPorEntorno(): DependenciasStudio {
  const config = leerConfiguracion(process.env);
  const proveedor = crearProveedor(config);
  return {
    directorio: config.directorio,
    proveedor,
    limites: { maxIteraciones: config.maxIteraciones, maxTokensSesion: config.maxTokensSesion, maxTokensProceso: config.maxTokensProceso },
    clasificador: crearClasificador(config.proveedor, proveedor),
  };
}
