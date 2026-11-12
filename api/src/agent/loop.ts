import type { LlamadaVisible, RespuestaChat } from "../http/types.ts";
import { mensajeDeError } from "../core/domain/result.ts";
import { type DefinicionHerramienta, type MensajeLlm, type ProveedorLlm, type RespuestaLlm, type UsoTokens, totalTokens } from "../llm/adapter.ts";
import type { ContextoHerramienta } from "../tools/tool.ts";
import { ejecutarLlamada } from "./execution.ts";
import { auditarBloqueo } from "./guardrails/audit.ts";
import { revisarRespaldo } from "./guardrails/grounding.ts";
import { type ClasificadorDeAlcance, respuestaDeBloqueo, revisarEntrada } from "./guardrails/input-guard.ts";
import { conCanario, nuevoCanario, revisarSalida } from "./guardrails/output-guard.ts";
import { definicionesParaModelo } from "./model-tools.ts";
import { leerPromptSistema } from "./prompt.ts";
import { type AlmacenSesiones, CerrojoPorSesion, type Sesion, nuevaSesion } from "./sessions.ts";
import { cerrarPendientes, conPreguntaExplicita, errorDeProveedor, mensajeDeTope, pendientesVigentes } from "./turn.ts";

/**
 * Ciclo ReAct de la recepcionista (PRD 6.3): prompt → modelo → herramientas `recepcion_*` → modelo … hasta
 * una respuesta de texto. El modelo decide cuándo consultar o encender el motor; el camino de cada contrato
 * lo fija el motor determinista. Solo conoce `ProveedorLlm`: cambiar de proveedor no toca este archivo.
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
  /** Clasificador de alcance de la guarda de entrada; sin él solo rigen las reglas deterministas. */
  clasificador?: ClasificadorDeAlcance | undefined;
}

/** Estado de un turno en curso: lo que el chat mostrará y lo que decide la confirmación (CA3). */
interface Turno {
  sesion: Sesion;
  ctx: ContextoHerramienta;
  llamadas: LlamadaVisible[];
  pendientesAlInicio: ReadonlySet<string>;
  nuevasPendientes: Set<string>;
  /** Mensajes que una decisión humana cerró en este turno (aprobados o rechazados). */
  resueltos: Set<string>;
}

export class AgenteContratos {
  readonly #deps: DependenciasCiclo;
  readonly #definiciones: DefinicionHerramienta[] = definicionesParaModelo();
  readonly #cerrojo = new CerrojoPorSesion();
  readonly #canario = nuevoCanario();
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
    sesion.pendientesConfirmacion = await pendientesVigentes(this.#deps.directorio, sesion.pendientesConfirmacion);
    const respuesta = (await this.#respuestaBloqueada(sesion, mensaje)) ?? (await this.#atender(sesion, mensaje));
    sesion.turnos.push({ ts: new Date().toISOString(), usuario: mensaje, respuesta });
    sesion.actualizada = new Date().toISOString();
    await this.#deps.sesiones.guardar(sesion);
    console.info(`[agente] sesión ${sessionId}: ${respuesta.toolCalls.length} llamadas, confirmación=${respuesta.needsConfirmation}, tokens=${totalTokens(sesion.tokens)}`);
    return respuesta;
  }

  /** Un mensaje bloqueado no entra al historial del modelo: queda solo en los turnos visibles y en el log. */
  async #respuestaBloqueada(sesion: Sesion, mensaje: string): Promise<RespuestaChat | null> {
    // Con el tope alcanzado el ciclo responde sin llamar al modelo; tampoco se gasta en el clasificador.
    if (this.#topeDeTokens(sesion)) return null;
    const ultimaRespuesta = sesion.turnos.at(-1)?.respuesta.reply ?? "";
    const { bloqueo, uso } = await revisarEntrada(mensaje, { clasificador: this.#deps.clasificador, ultimaRespuesta });
    this.#contarTokens(sesion, uso);
    if (!bloqueo) return null;
    await auditarBloqueo(this.#deps.directorio, sesion.id, "guarda_entrada", `${bloqueo.motivo}: ${bloqueo.detalle}`);
    return { reply: respuestaDeBloqueo(bloqueo, sesion.pendientesConfirmacion), toolCalls: [], needsConfirmation: false };
  }

  async #atender(sesion: Sesion, mensaje: string): Promise<RespuestaChat> {
    const turno = this.#iniciarTurno(sesion, mensaje);
    const texto = await this.#resolver(turno).catch((error: unknown) => `Ocurrió un error interno: ${mensajeDeError(error)}. Puedes volver a intentarlo.`);
    return this.#cerrarTurno(turno, texto);
  }

  #iniciarTurno(sesion: Sesion, mensaje: string): Turno {
    sesion.mensajes.push({ rol: "usuario", texto: mensaje });
    return {
      sesion,
      ctx: { directory: this.#deps.directorio, sessionId: sesion.id, ...(this.#deps.hoy ? { hoy: this.#deps.hoy } : {}) },
      llamadas: [],
      pendientesAlInicio: new Set(sesion.pendientesConfirmacion),
      nuevasPendientes: new Set(),
      resueltos: new Set(),
    };
  }

  async #resolver(turno: Turno): Promise<string> {
    const sistema = conCanario(await (this.#deps.cargarSistema ?? (() => leerPromptSistema(this.#deps.directorio)))(), this.#canario);
    const salida = revisarSalida(await this.#iterar(turno, sistema), this.#canario);
    if (salida.filtrada) await auditarBloqueo(this.#deps.directorio, turno.sesion.id, "guarda_salida", "la respuesta contenía el canario del prompt de sistema");
    return salida.texto;
  }

  async #iterar(turno: Turno, sistema: string): Promise<string> {
    const { maxIteraciones } = this.#deps.limites;
    let ultimoTexto = "";
    for (let iteracion = 0; iteracion < maxIteraciones; iteracion++) {
      const tope = this.#topeDeTokens(turno.sesion);
      if (tope) return tope;
      const respuesta = await this.#deps.proveedor.enviar([{ rol: "sistema", texto: sistema }, ...turno.sesion.mensajes], this.#definiciones);
      if (!respuesta.ok) return errorDeProveedor(this.#deps.proveedor, respuesta.error);
      this.#contarTokens(turno.sesion, respuesta.data.uso);
      if (respuesta.data.llamadas.length === 0) return this.#conRespaldo(turno, sistema, respuesta.data.texto.trim() || "(el modelo no devolvió texto)");
      ultimoTexto = respuesta.data.texto.trim() || ultimoTexto;
      await this.#ejecutarLlamadas(turno, respuesta.data);
    }
    return mensajeDeTope(maxIteraciones, turno.llamadas, ultimoTexto);
  }

  /** CA2: lo que el modelo afirma debe salir de herramientas, de la analista o del prompt; sus respuestas previas no cuentan. */
  async #conRespaldo(turno: Turno, sistema: string, texto: string): Promise<string> {
    const fuentes = [sistema, ...turno.sesion.mensajes.flatMap((mensaje) => (mensaje.rol === "usuario" ? [mensaje.texto] : mensaje.rol === "herramienta" ? [mensaje.resultado] : []))];
    const revisado = revisarRespaldo(texto, fuentes);
    if (revisado.sinRespaldo.length > 0) await auditarBloqueo(this.#deps.directorio, turno.sesion.id, "guarda_respaldo", `datos sin respaldo: ${revisado.sinRespaldo.join(", ")}`);
    return revisado.texto;
  }

  async #ejecutarLlamadas(turno: Turno, respuesta: RespuestaLlm): Promise<void> {
    turno.sesion.mensajes.push({ rol: "asistente", texto: respuesta.texto, llamadas: respuesta.llamadas });
    for (const llamada of respuesta.llamadas) {
      const ejecutada = await ejecutarLlamada(llamada, turno.ctx, turno.pendientesAlInicio);
      turno.sesion.mensajes.push({ rol: "herramienta", id: llamada.id, nombre: llamada.nombre, resultado: ejecutada.json });
      turno.llamadas.push(ejecutada.visible);
      for (const id of ejecutada.efecto.enRevision) turno.nuevasPendientes.add(id);
      for (const id of ejecutada.efecto.resueltos) turno.resueltos.add(id);
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

  #contarTokens(sesion: Sesion, uso: UsoTokens): void {
    sesion.tokens.entrada += uso.entrada;
    sesion.tokens.salida += uso.salida;
    this.#tokensProceso += totalTokens(uso);
  }

  #cerrarTurno(turno: Turno, texto: string): RespuestaChat {
    const { pendientes, nuevas } = cerrarPendientes(turno.pendientesAlInicio, turno.nuevasPendientes, turno.resueltos);
    turno.sesion.pendientesConfirmacion = pendientes;
    const reply = conPreguntaExplicita(texto, nuevas);
    // El historial del modelo siempre cierra con un mensaje del asistente para conservar la alternancia de roles.
    turno.sesion.mensajes.push({ rol: "asistente", texto: reply, llamadas: [] } satisfies MensajeLlm);
    return { reply, toolCalls: turno.llamadas, needsConfirmation: nuevas.length > 0 };
  }
}
