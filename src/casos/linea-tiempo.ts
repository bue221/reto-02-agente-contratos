import type { AnalisisGuardado } from "../almacen/analisis.ts";
import type { EntradaHistorial } from "../almacen/bitacoras.ts";
import type { DecisionHumana } from "../almacen/decisiones.ts";
import type { EstadoMensaje, PasoLineaTiempo } from "../api/tipos.ts";
import { CAMPOS_CONTRATO, type Contrato } from "../dominio/contrato.ts";
import { UMBRAL_CONFIANZA } from "../dominio/parametros.ts";

/** Los 7 pasos por los que pasa un correo, derivados del estado en `out/` (solo lectura). */

export interface EntradaLineaTiempo {
  fecha: string;
  adjuntos: number;
  adjuntoContrato: string | null;
  estado: EstadoMensaje;
  analisis: AnalisisGuardado | null;
  extraccion: Contrato | null;
  decision: DecisionHumana | null;
  historial: (EntradaHistorial & { ts: string }) | null;
}

type Paso = Omit<PasoLineaTiempo, "id" | "titulo">;

const paso = (estado: PasoLineaTiempo["estado"], detalle: string | null = null, ts: string | null = null): Paso => ({ estado, detalle, ts });
const PENDIENTE = paso("pendiente");
const CERRADOS_SIN_ESCRITURA: ReadonlySet<EstadoMensaje> = new Set(["duplicado", "rechazado"]);

function contratoDetectado(e: EntradaLineaTiempo): Paso {
  if (e.adjuntoContrato) return paso("hecho", e.adjuntoContrato);
  return e.analisis ? paso("alerta", "Sin adjunto de contrato (RN4)") : paso("pendiente", "Ningún adjunto parece un contrato");
}

function datosExtraidos(e: EntradaLineaTiempo): Paso {
  if (!e.analisis) return PENDIENTE;
  if (!e.adjuntoContrato || !e.extraccion) return paso("omitido", "No aplica sin contrato", e.analisis.ts);
  const campos = CAMPOS_CONTRATO.map((campo) => e.extraccion?.[campo]).filter((campo) => campo !== undefined);
  const conValor = campos.filter((campo) => campo.valor !== null).length;
  const dudosos = campos.filter((campo) => campo.confianza < UMBRAL_CONFIANZA).length;
  const detalle = `${conValor}/${campos.length} campos${dudosos ? ` · ${dudosos} con confianza < ${UMBRAL_CONFIANZA}` : ""}`;
  return paso(dudosos ? "alerta" : "hecho", detalle, e.analisis.ts);
}

function validado(e: EntradaLineaTiempo): Paso {
  if (!e.analisis) return PENDIENTE;
  const { clasificacion, requiere_revision, motivo } = e.analisis.validacion;
  if (requiere_revision.length > 0) return paso("alerta", `${clasificacion} · revisar ${requiere_revision.join(", ")}`, e.analisis.ts);
  return paso("hecho", motivo ? `${clasificacion} · ${motivo}` : clasificacion, e.analisis.ts);
}

function revisionHumana(e: EntradaLineaTiempo): Paso {
  const { decision } = e;
  if (decision) {
    const corregidos = Object.keys(decision.correcciones);
    const extra = decision.motivo ? ` · «${decision.motivo}»` : corregidos.length ? ` · corrigió ${corregidos.join(", ")}` : "";
    return paso("hecho", `${decision.aprobador} (${decision.via}): ${decision.decision}${extra}`, decision.ts);
  }
  if (e.estado === "requiere_revision") return paso("actual", "Esperando aprobación en la bandeja o en el chat");
  return e.analisis ? paso("omitido", "No requiere revisión") : PENDIENTE;
}

function registroEnMaestro(e: EntradaLineaTiempo): Paso {
  if (e.historial) return paso("hecho", `${e.historial.accion} ${e.historial.id_contrato}`, e.historial.ts);
  if (CERRADOS_SIN_ESCRITURA.has(e.estado)) return paso("omitido", `${e.estado}: maestro sin cambios`);
  return e.estado === "requiere_revision" ? paso("pendiente", "Nada se escribe sin confirmación") : PENDIENTE;
}

function archivado(e: EntradaLineaTiempo): Paso {
  if (e.historial) return paso("hecho", e.historial.ruta_archivo, e.historial.ts);
  return CERRADOS_SIN_ESCRITURA.has(e.estado) ? paso("omitido", "Sin archivo") : PENDIENTE;
}

export function lineaDeTiempo(e: EntradaLineaTiempo): PasoLineaTiempo[] {
  return [
    { id: "recibido", titulo: "Correo recibido", ...paso("hecho", `${e.adjuntos} adjunto(s)`, e.fecha) },
    { id: "contrato", titulo: "Contrato detectado", ...contratoDetectado(e) },
    { id: "extraido", titulo: "Datos extraídos", ...datosExtraidos(e) },
    { id: "validado", titulo: "Validado (RN1–RN5)", ...validado(e) },
    { id: "revision", titulo: "Revisión humana", ...revisionHumana(e) },
    { id: "registro", titulo: "Registro en maestro", ...registroEnMaestro(e) },
    { id: "archivo", titulo: "Archivo SharePoint", ...archivado(e) },
  ];
}
