import { leerProcesados } from "../almacen/bitacoras.ts";
import { rutasDelProyecto } from "../almacen/rutas.ts";
import type { LlamadaVisible, RespuestaChat } from "../api/tipos.ts";
import { mensajeDeError } from "../dominio/resultado.ts";
import { type DefinicionHerramienta, type MensajeLlm, type ProveedorLlm, type RespuestaLlm, totalTokens } from "../llm/adapter.ts";
import type { ContextoHerramienta } from "../tools/herramienta.ts";
import { ejecutarLlamada } from "./ejecucion.ts";
import { definicionesParaModelo } from "./herramientas-modelo.ts";
import { leerPromptSistema } from "./prompt.ts";
import { type AlmacenSesiones, CerrojoPorSesion, type Sesion, nuevaSesion } from "./sesiones.ts";

/**
 * Ciclo del agente (PRD 6.3): prompt → modelo → herramientas → modelo … hasta una respuesta de texto.
 * Solo conoce `ProveedorLlm`: cambiar de proveedor no toca este archivo.
 */

export interface LimitesCiclo {
  /** CA1: llamadas al modelo por turno. */
  maxIteraciones: number;
  /** Costo: tokens acumulados por sesión. */
  maxTokensSesion: number;
  /** Costo: tokens acumulados por el proceso, para que abrir sesiones nuevas no evada el tope. */
  maxTokensProceso: number;
}

export interface DependenciasCiclo {
  proveedor: ProveedorLlm;
  sesiones: AlmacenSesiones;
  directorio: string;
  limites: LimitesCiclo;
  /** Por defecto lee `agent/prompt.md` + conocimiento en cada turno. */
  cargarSistema?: () => Promise<string>;
  /** Fecha de registro fija para tests deterministas. */
  hoy?: string;
}

/** Estado de un turno en curso: lo que el chat mostrará y lo que decide la confirmación (CA3). */
interface Turno {
  sesion: Sesion;
  ctx: ContextoHerramienta;
  llamadas: LlamadaVisible[];
  pendientesAlInicio: ReadonlySet<string>;
  nuevasPendientes: Set<string>;
  registrados: Set<string>;
}

export class AgenteContratos {
  readonly #deps: DependenciasCiclo;
  readonly #definiciones: DefinicionHerramienta[] = definicionesParaModelo();
  readonly #cerrojo = new CerrojoPorSesion();
  #tokensProceso = 0;

  constructor(deps: DependenciasCiclo) {
    this.#deps = deps;
  }

  get proveedor(): ProveedorLlm {
    return this.#deps.proveedor;
  }

  /** Nunca lanza (CA5): cualquier fallo vuelve como respuesta legible y la sesión sigue utilizable. */
  conversar(sessionId: string, mensaje: string): Promise<RespuestaChat> {
    return this.#cerrojo.ejecutar(sessionId, () => this.#turno(sessionId, mensaje));
  }

  async #turno(sessionId: string, mensaje: string): Promise<RespuestaChat> {
    const sesion = (await this.#deps.sesiones.obtener(sessionId)) ?? nuevaSesion(sessionId);
    sesion.pendientesConfirmacion = await this.#pendientesVigentes(sesion.pendientesConfirmacion);
    const turno = this.#iniciarTurno(sesion, mensaje);
    const texto = await this.#resolver(turno).catch((error: unknown) => `Ocurrió un error interno: ${mensajeDeError(error)}. Puedes volver a intentarlo.`);
    const respuesta = this.#cerrarTurno(turno, texto);
    sesion.turnos.push({ ts: new Date().toISOString(), usuario: mensaje, respuesta });
    sesion.actualizada = new Date().toISOString();
    await this.#deps.sesiones.guardar(sesion);
    console.info(`[agente] sesión ${sessionId}: ${respuesta.toolCalls.length} llamadas, confirmación=${respuesta.needsConfirmation}, tokens=${totalTokens(sesion.tokens)}`);
    return respuesta;
  }

  /** Un mensaje resuelto en otro canal (bandeja u otra sesión) deja de esperar confirmación aquí. */
  async #pendientesVigentes(pendientes: readonly string[]): Promise<string[]> {
    if (pendientes.length === 0) return [];
    try {
      const procesados = await leerProcesados(rutasDelProyecto(this.#deps.directorio));
      return pendientes.filter((id) => !(id in procesados));
    } catch (error) {
      console.error(`[agente] no se pudo leer procesados.json: ${mensajeDeError(error)}`);
      return [...pendientes];
    }
  }

  #iniciarTurno(sesion: Sesion, mensaje: string): Turno {
    sesion.mensajes.push({ rol: "usuario", texto: mensaje });
    return {
      sesion,
      ctx: { directory: this.#deps.directorio, sessionId: sesion.id, ...(this.#deps.hoy ? { hoy: this.#deps.hoy } : {}) },
      llamadas: [],
      pendientesAlInicio: new Set(sesion.pendientesConfirmacion),
      nuevasPendientes: new Set(),
      registrados: new Set(),
    };
  }

  async #resolver(turno: Turno): Promise<string> {
    const sistema = await (this.#deps.cargarSistema ?? (() => leerPromptSistema(this.#deps.directorio)))();
    const { maxIteraciones } = this.#deps.limites;
    let ultimoTexto = "";
    for (let iteracion = 0; iteracion < maxIteraciones; iteracion++) {
      const tope = this.#topeDeTokens(turno.sesion);
      if (tope) return tope;
      const respuesta = await this.#deps.proveedor.enviar([{ rol: "sistema", texto: sistema }, ...turno.sesion.mensajes], this.#definiciones);
      if (!respuesta.ok) return errorDeProveedor(this.#deps.proveedor, respuesta.error);
      this.#contarTokens(turno.sesion, respuesta.data);
      if (respuesta.data.llamadas.length === 0) return respuesta.data.texto.trim() || "(el modelo no devolvió texto)";
      ultimoTexto = respuesta.data.texto.trim() || ultimoTexto;
      await this.#ejecutarLlamadas(turno, respuesta.data);
    }
    return mensajeDeTope(maxIteraciones, turno.llamadas, ultimoTexto);
  }

  async #ejecutarLlamadas(turno: Turno, respuesta: RespuestaLlm): Promise<void> {
    turno.sesion.mensajes.push({ rol: "asistente", texto: respuesta.texto, llamadas: respuesta.llamadas });
    for (const llamada of respuesta.llamadas) {
      const ejecutada = await ejecutarLlamada(llamada, turno.ctx, turno.pendientesAlInicio);
      turno.sesion.mensajes.push({ rol: "herramienta", id: llamada.id, nombre: llamada.nombre, resultado: ejecutada.json });
      turno.llamadas.push(ejecutada.visible);
      if (ejecutada.revision?.estado === "pendiente") turno.nuevasPendientes.add(ejecutada.revision.mensajeId);
      if (ejecutada.revision?.estado === "registrado") turno.registrados.add(ejecutada.revision.mensajeId);
    }
  }

  #topeDeTokens(sesion: Sesion): string | null {
    const { maxTokensSesion, maxTokensProceso } = this.#deps.limites;
    if (totalTokens(sesion.tokens) >= maxTokensSesion) {
      return `Esta sesión alcanzó el tope de ${maxTokensSesion} tokens. Abre una sesión nueva para continuar; lo ya registrado queda en out/.`;
    }
    if (this.#tokensProceso >= maxTokensProceso) return `El servidor alcanzó su tope de consumo (${maxTokensProceso} tokens). Intenta más tarde.`;
    return null;
  }

  #contarTokens(sesion: Sesion, respuesta: RespuestaLlm): void {
    sesion.tokens.entrada += respuesta.uso.entrada;
    sesion.tokens.salida += respuesta.uso.salida;
    this.#tokensProceso += totalTokens(respuesta.uso);
  }

  /** CA3 determinista: la confirmación se decide por los resultados de `registrar`, no por el texto del modelo. */
  #cerrarTurno(turno: Turno, texto: string): RespuestaChat {
    const { sesion, registrados } = turno;
    const nuevas = [...turno.nuevasPendientes].filter((id) => !registrados.has(id));
    sesion.pendientesConfirmacion = [...new Set([...turno.pendientesAlInicio, ...nuevas])].filter((id) => !registrados.has(id));
    const needsConfirmation = nuevas.length > 0;
    const reply = needsConfirmation && !texto.endsWith("?") ? `${texto}\n\n${preguntaExplicita(nuevas)}` : texto;
    // El historial del modelo siempre cierra con un mensaje del asistente para conservar la alternancia de roles.
    sesion.mensajes.push({ rol: "asistente", texto: reply, llamadas: [] } satisfies MensajeLlm);
    return { reply, toolCalls: turno.llamadas, needsConfirmation };
  }
}

const preguntaExplicita = (ids: readonly string[]): string =>
  `¿Confirmas los campos en revisión de ${ids.join(", ")}? Responde «confirmo …» con los valores correctos para registrarlos.`;

const errorDeProveedor = (proveedor: ProveedorLlm, error: string): string =>
  `No pude obtener respuesta del modelo (${proveedor.nombre}/${proveedor.modelo}): ${error}. La sesión sigue activa: vuelve a intentarlo en un momento.`;

function mensajeDeTope(maxIteraciones: number, llamadas: readonly LlamadaVisible[], ultimoTexto: string): string {
  const hechas = llamadas.map((llamada) => `- ${llamada.nombre}: ${llamada.ok ? "ok" : "error"} — ${llamada.resumen}`);
  return [
    `Alcancé el tope de ${maxIteraciones} iteraciones de este turno sin terminar.`,
    ultimoTexto,
    hechas.length > 0 ? `Lo que alcancé a hacer:\n${hechas.join("\n")}` : "No alcancé a ejecutar herramientas.",
    "Lo que falta: revisar esos resultados y completar los pasos pendientes. Escribe «continúa» para seguir desde aquí.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
