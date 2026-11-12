import { leerConfiguracion } from "../../api/src/config.ts";
import { crearProveedor } from "../../api/src/llm/factory.ts";
import type { ProveedorLlm } from "../../api/src/llm/adapter.ts";

/**
 * Lo que comparten los grafos de Studio con la app: la misma raíz del proyecto (mismo `out/`, así lo que
 * se haga en Studio aparece en el buzón y la bandeja) y el mismo proveedor elegido por entorno.
 */

export interface DependenciasStudio {
  /** Raíz del proyecto: `ctx.directory` de las herramientas. */
  directorio: string;
  proveedor: ProveedorLlm;
  maxIteraciones: number;
  /** Por defecto `agent/prompt.md` + conocimiento, leídos en cada turno como en la app. */
  cargarSistema?: () => Promise<string>;
}

export function dependenciasPorEntorno(): DependenciasStudio {
  const config = leerConfiguracion(process.env);
  return { directorio: config.directorio, proveedor: crearProveedor(config), maxIteraciones: config.maxIteraciones };
}
