/**
 * Read model del buzón para la UI: estado por correo y timeline de pasos.
 * Se deriva de propuestas + auditoría; solo lectura, sin reglas de negocio nuevas.
 */
import { getAudit, getCfg, getMailbox, getPropuestas } from "../deps.ts";
import { AppError } from "../domain/errors.ts";
import type { Correo, Decision, Extraccion, Propuesta } from "../domain/types.ts";
import { ETIQUETA_DECISION } from "../hitl/format.ts";

export type EstadoCorreo = "SIN_ANALIZAR" | "PENDIENTE" | "APROBADA" | "RECHAZADA";

export interface CorreoResumen {
  id: string;
  de: string;
  fecha: string;
  asunto: string;
  adjuntos: string[];
  estado: EstadoCorreo;
  recomendacion: Decision | null;
  decisionFinal: Decision | null;
  contratoId: string | null;
}

export type EstadoPaso = "hecho" | "actual" | "pendiente" | "omitido" | "alerta";

export interface PasoTimeline {
  id:
    | "cargado"
    | "clasificado"
    | "extraido"
    | "validado"
    | "recomendacion"
    | "decision_humana"
    | "ejecutado";
  titulo: string;
  estado: EstadoPaso;
  detalle: string | null;
  ts: string | null;
}

export interface EventoAuditoria {
  ts: string;
  fase: string | null;
  decision: string | null;
  aprobador: string | null;
  log: string[];
}

export interface CorreoDetalle {
  correo: Correo;
  estado: EstadoCorreo;
  propuesta: Propuesta | null;
  /** Lo que extrajo el agente antes de la revisión humana (confianzas reales). */
  extraccionOriginal: Extraccion | null;
  timeline: PasoTimeline[];
  eventos: EventoAuditoria[];
}

function estadoDe(p: Propuesta | null): EstadoCorreo {
  return p ? p.estado : "SIN_ANALIZAR";
}

export function listarCorreos(): CorreoResumen[] {
  const mailbox = getMailbox();
  const propuestas = getPropuestas();
  return mailbox.listIds().map((id) => {
    const c = mailbox.getMessage(id);
    const p = propuestas.get(id);
    return {
      id,
      de: c.de,
      fecha: c.fecha,
      asunto: c.asunto,
      adjuntos: c.adjuntos.map((a) => a.nombre),
      estado: estadoDe(p),
      recomendacion: p?.recomendacion ?? null,
      decisionFinal: p?.resolucion?.decisionFinal ?? null,
      contratoId: p?.resolucion?.contratoId ?? null,
    };
  });
}

function construirTimeline(
  correo: Correo,
  p: Propuesta | null,
  eventos: EventoAuditoria[],
  extraccionOriginal: Extraccion | null,
): PasoTimeline[] {
  const pendiente = (id: PasoTimeline["id"], titulo: string): PasoTimeline => ({
    id,
    titulo,
    estado: "pendiente",
    detalle: null,
    ts: null,
  });

  if (!p) {
    return [
      { ...pendiente("cargado", "Correo cargado"), detalle: `${correo.adjuntos.length} adjunto(s)` },
      pendiente("clasificado", "Clasificado"),
      pendiente("extraido", "Datos extraídos"),
      pendiente("validado", "Reglas validadas"),
      pendiente("recomendacion", "Recomendación del agente"),
      pendiente("decision_humana", "Decisión humana"),
      pendiente("ejecutado", "Ejecutado"),
    ];
  }

  const umbral = getCfg().umbralConfianza;
  const ts = p.creadaEn;
  const r = p.resolucion;

  // Tras aprobar, la propuesta guarda confianza 1.0 (confirmado por humano);
  // la extracción original del agente muestra si hubo campos dudosos.
  const campos = Object.values(extraccionOriginal ?? p.extraccion ?? {});
  const conValor = campos.filter((c) => c.valor !== null);
  const bajos = conValor.filter((c) => c.confianza < umbral).length;

  const fallidas = p.validaciones.filter((v) => !v.ok);
  const bloqueos = eventos.filter((e) => e.decision === "BLOQUEADO_POR_REGLAS");

  const extraido: PasoTimeline = p.extraccion
    ? {
        id: "extraido",
        titulo: "Datos extraídos",
        estado: bajos ? "alerta" : "hecho",
        detalle: `${conValor.length} campo(s) desde ${p.documento ?? "el adjunto"}${bajos ? ` · ${bajos} con confianza baja` : ""}`,
        ts,
      }
    : {
        id: "extraido",
        titulo: "Datos extraídos",
        estado: "omitido",
        detalle: `No aplica para tipo "${p.clasificacion.tipo}"`,
        ts,
      };

  const decision: PasoTimeline = r
    ? {
        id: "decision_humana",
        titulo: "Decisión humana",
        estado: "hecho",
        detalle:
          `${r.aprobador}: ${r.accion}` +
          (Object.keys(r.correcciones ?? {}).length
            ? ` · corrigió ${Object.keys(r.correcciones).join(", ")}`
            : "") +
          (r.comentario ? ` · “${r.comentario}”` : ""),
        ts: r.resueltaEn,
      }
    : {
        id: "decision_humana",
        titulo: "Decisión humana",
        estado: bloqueos.length ? "alerta" : "actual",
        detalle: bloqueos.length
          ? `Esperando tu aprobación · ${bloqueos.length} intento(s) bloqueado(s) por reglas`
          : "Esperando tu aprobación en la bandeja",
        ts: bloqueos.at(-1)?.ts ?? null,
      };

  const ejecutado: PasoTimeline = r
    ? {
        id: "ejecutado",
        titulo: "Ejecutado",
        estado: "hecho",
        detalle:
          r.accion === "rechazar"
            ? "Archivado en rechazados · maestro sin cambios"
            : `${r.decisionFinal}${r.contratoId ? ` → ${r.contratoId}` : ""} · ${r.archivos.length} archivo(s)`,
        ts: r.resueltaEn,
      }
    : { ...pendiente("ejecutado", "Ejecutado"), detalle: "Nada se ejecuta sin tu aprobación" };

  return [
    {
      id: "cargado",
      titulo: "Correo cargado",
      estado: "hecho",
      detalle: `${correo.adjuntos.length} adjunto(s)`,
      ts,
    },
    {
      id: "clasificado",
      titulo: "Clasificado",
      estado: "hecho",
      detalle: `${p.clasificacion.tipo} (${Math.round(p.clasificacion.confianza * 100)}%) · motor ${p.motor}`,
      ts,
    },
    extraido,
    {
      id: "validado",
      titulo: "Reglas validadas",
      estado: fallidas.length ? "alerta" : "hecho",
      detalle: `${p.validaciones.length - fallidas.length}/${p.validaciones.length} reglas OK`,
      ts,
    },
    {
      id: "recomendacion",
      titulo: "Recomendación del agente",
      estado: "hecho",
      detalle: ETIQUETA_DECISION[p.recomendacion],
      ts,
    },
    decision,
    ejecutado,
  ];
}

export function detalleCorreo(id: string): CorreoDetalle {
  const mailbox = getMailbox();
  if (!mailbox.listIds().includes(id)) {
    throw new AppError("NOT_FOUND", `No existe el correo ${id}`, 404);
  }
  const correo = mailbox.getMessage(id);
  const propuesta = getPropuestas().get(id);
  const registros = getAudit().forMsg(id);
  const eventos: EventoAuditoria[] = registros.map((e) => ({
    ts: e.ts,
    fase: e.fase ?? null,
    decision: e.decision ? String(e.decision) : null,
    aprobador: e.aprobador ?? null,
    log: e.log ?? [],
  }));
  const extraccionOriginal =
    registros.filter((e) => e.fase === "propuesta").at(-1)?.extraccion ?? null;
  return {
    correo,
    estado: estadoDe(propuesta),
    propuesta,
    extraccionOriginal,
    timeline: construirTimeline(correo, propuesta, eventos, extraccionOriginal),
    eventos,
  };
}
