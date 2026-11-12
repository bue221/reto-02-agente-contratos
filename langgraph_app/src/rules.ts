import type { Config } from "./config.ts";
import type { MasterRepository } from "./adapters/master.ts";
import type { Decision, Validacion } from "./types.ts";
import type { PipelineState } from "./state.ts";
import { formatoCOP } from "./parse.ts";

const PROCESABLES = ["contrato", "otrosi", "actualizacion"];

export function buscarDuplicado(
  state: PipelineState,
  repo: MasterRepository,
): string | undefined {
  const ex = state.extraccion;
  const tipo = state.clasificacion?.tipo;
  if (!ex) return undefined;

  if (tipo === "contrato") {
    return repo.all().find(
      (c) =>
        c.nit === ex.nit.valor &&
        c.valor === ex.valor.valor &&
        c.fecha_inicio === ex.fechaInicio.valor &&
        c.fecha_fin === ex.fechaFin.valor,
    )?.id_contrato;
  }
  if ((tipo === "otrosi" || tipo === "actualizacion") && state.existente) {
    const e = state.existente;
    const iguales =
      (ex.valor.valor === null || ex.valor.valor === e.valor) &&
      (ex.fechaInicio.valor === null || ex.fechaInicio.valor === e.fecha_inicio) &&
      (ex.fechaFin.valor === null || ex.fechaFin.valor === e.fecha_fin);
    return iguales ? e.id_contrato : undefined;
  }
  return undefined;
}

export function evaluarReglas(
  state: PipelineState,
  repo: MasterRepository,
  cfg: Config,
): Validacion[] {
  const v: Validacion[] = [];
  const tipo = state.clasificacion?.tipo ?? "otro";
  const ex = state.extraccion;

  const procesable = PROCESABLES.includes(tipo);
  v.push({
    regla: "tipo_procesable",
    ok: procesable,
    severidad: "bloqueante",
    detalle: procesable
      ? `Tipo: ${tipo}`
      : `Se clasificó como "${tipo}": no es contrato, otrosí ni actualización`,
  });

  v.push({
    regla: "autor_resuelto",
    ok: !!state.autor,
    severidad: "bloqueante",
    detalle: state.autor
      ? `Comercial: ${state.autor.nombre} (${state.autor.region})`
      : `El remitente "${state.correo?.de}" no está en el catálogo de comerciales`,
  });

  if (!procesable || !ex) return v;

  const esModificacion = tipo === "otrosi" || tipo === "actualizacion";
  let faltan: string[];
  if (esModificacion) {
    faltan = [];
    if (ex.idContrato.valor === null && ex.nit.valor === null && !state.existente) {
      faltan.push("id de contrato o NIT");
    }
    if (ex.valor.valor === null && ex.fechaInicio.valor === null && ex.fechaFin.valor === null) {
      faltan.push("al menos un dato a modificar");
    }
  } else {
    faltan = (["cliente", "nit", "valor", "fechaInicio", "fechaFin"] as const)
      .filter((k) => ex[k].valor === null);
  }
  v.push({
    regla: "campos_obligatorios",
    ok: faltan.length === 0,
    severidad: "bloqueante",
    detalle: faltan.length ? `Faltan: ${faltan.join(", ")}` : "Todos los campos requeridos están presentes",
  });

  if (ex.nit.valor !== null) {
    const ok = /^\d{3}\.\d{3}\.\d{3}-\d$/.test(ex.nit.valor);
    v.push({
      regla: "formato_nit",
      ok,
      severidad: "bloqueante",
      detalle: ok ? "NIT con formato válido" : `NIT con formato inválido: ${ex.nit.valor}`,
    });
  }

  if (ex.valor.valor !== null) {
    const ok = ex.valor.valor > 0;
    v.push({
      regla: "valor_positivo",
      ok,
      severidad: "bloqueante",
      detalle: ok ? `Valor ${formatoCOP(ex.valor.valor)}` : "El valor debe ser mayor que cero",
    });
  }

  if (esModificacion) {
    v.push({
      regla: "referencia_existe",
      ok: !!state.existente,
      severidad: "bloqueante",
      detalle: state.existente
        ? `Referencia a ${state.existente.id_contrato}`
        : "No se encontró el contrato referenciado en el maestro",
    });
    if (state.existente && ex.nit.valor !== null) {
      const ok = state.existente.nit === ex.nit.valor;
      v.push({
        regla: "nit_coincide",
        ok,
        severidad: "bloqueante",
        detalle: ok
          ? "NIT coincide con el maestro"
          : `NIT ${ex.nit.valor} no coincide con ${state.existente.nit}`,
      });
    }
  }

  const inicio = ex.fechaInicio.valor ?? state.existente?.fecha_inicio ?? null;
  const fin = ex.fechaFin.valor ?? state.existente?.fecha_fin ?? null;
  if (inicio && fin) {
    const ok = fin > inicio;
    v.push({
      regla: "fechas_coherentes",
      ok,
      severidad: "bloqueante",
      detalle: ok
        ? `Vigencia ${inicio} → ${fin}`
        : `Fecha fin (${fin}) no es posterior al inicio (${inicio})`,
    });
  }

  const dup = buscarDuplicado(state, repo);
  v.push({
    regla: "no_duplicado",
    ok: !dup,
    severidad: "bloqueante",
    detalle: dup ? `Ya existe en el maestro como ${dup}` : "No existe un registro equivalente",
  });

  const bajos = (["idContrato", "cliente", "nit", "valor", "fechaInicio", "fechaFin"] as const)
    .filter((k) => ex[k].valor !== null && ex[k].confianza < cfg.umbralConfianza)
    .map((k) => `${k} (${ex[k].confianza.toFixed(2)})`);
  v.push({
    regla: "confianza_minima",
    ok: bajos.length === 0,
    severidad: "revision",
    detalle: bajos.length
      ? `Confianza por debajo de ${cfg.umbralConfianza}: ${bajos.join(", ")}`
      : `Todos los campos ≥ ${cfg.umbralConfianza}`,
  });

  return v;
}

export function decidirDesdeValidaciones(
  state: PipelineState,
): { decision: Decision; motivos: string[] } {
  const fallas = (state.validaciones ?? []).filter((x) => !x.ok);
  const falla = (r: string) => fallas.find((x) => x.regla === r);
  const motivos = (xs: typeof fallas) => xs.map((x) => x.detalle);
  const tipo = state.clasificacion?.tipo;
  if (!tipo) {
    return {
      decision: "REVISION_HUMANA",
      motivos: ["Estado incompleto: falta clasificación. Corre el grafo desde el inicio con msgId."],
    };
  }

  if (falla("tipo_procesable")) {
    return { decision: "RECHAZAR", motivos: motivos([falla("tipo_procesable")!]) };
  }
  if (falla("autor_resuelto")) {
    return { decision: "RECHAZAR", motivos: motivos([falla("autor_resuelto")!]) };
  }
  if (falla("no_duplicado")) {
    return { decision: "DUPLICADO", motivos: motivos([falla("no_duplicado")!]) };
  }
  const bloqueantes = fallas.filter((x) => x.severidad === "bloqueante");
  if (bloqueantes.length) {
    return { decision: "RECHAZAR", motivos: motivos(bloqueantes) };
  }
  if (fallas.length) {
    return { decision: "REVISION_HUMANA", motivos: motivos(fallas) };
  }
  return {
    decision: tipo === "contrato" ? "REGISTRAR_NUEVO" : "ACTUALIZAR",
    motivos: ["Todas las validaciones pasaron"],
  };
}
