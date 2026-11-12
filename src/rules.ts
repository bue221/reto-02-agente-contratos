import type { Config } from "./config.ts";
import type { MasterRepository } from "./adapters/master-repo.ts";
import type { Ctx, Validacion } from "./types.ts";
import { formatoCOP } from "./util.ts";

/**
 * Reglas de negocio: funciones puras y deterministas, SIN LLM.
 * Cada regla devuelve una Validacion; la decisión final se deriva de ellas en pipeline/index.ts.
 */
const PROCESABLES = ["contrato", "otrosi", "actualizacion"];

export function evaluarReglas(ctx: Ctx, repo: MasterRepository, cfg: Config): Validacion[] {
  const v: Validacion[] = [];
  const tipo = ctx.clasificacion?.tipo ?? "otro";
  const ex = ctx.extraccion;

  // 1. ¿Es un documento que podemos procesar?
  const procesable = PROCESABLES.includes(tipo);
  v.push({
    regla: "tipo_procesable", ok: procesable, severidad: "bloqueante",
    detalle: procesable ? `Tipo: ${tipo}` : `Se clasificó como "${tipo}": no es contrato, otrosí ni actualización`,
  });

  // 2. ¿Sabemos quién lo envió? (autoría)
  v.push({
    regla: "autor_resuelto", ok: !!ctx.autor, severidad: "bloqueante",
    detalle: ctx.autor
      ? `Comercial: ${ctx.autor.nombre} (${ctx.autor.region})`
      : `El remitente "${ctx.correo?.de}" no está en el catálogo de comerciales`,
  });

  if (!procesable || !ex) return v;

  const esModificacion = tipo === "otrosi" || tipo === "actualizacion";

  // 3. Campos obligatorios
  let faltan: string[];
  if (esModificacion) {
    faltan = [];
    if (ex.idContrato.valor === null && ex.nit.valor === null && !ctx.existente) faltan.push("id de contrato o NIT");
    if (ex.valor.valor === null && ex.fechaInicio.valor === null && ex.fechaFin.valor === null) faltan.push("al menos un dato a modificar");
  } else {
    faltan = (["cliente", "nit", "valor", "fechaInicio", "fechaFin"] as const).filter((k) => ex[k].valor === null);
  }
  v.push({
    regla: "campos_obligatorios", ok: faltan.length === 0, severidad: "bloqueante",
    detalle: faltan.length ? `Faltan: ${faltan.join(", ")}` : "Todos los campos requeridos están presentes",
  });

  // 4. Formato de NIT
  if (ex.nit.valor !== null) {
    const ok = /^\d{3}\.\d{3}\.\d{3}-\d$/.test(ex.nit.valor);
    v.push({ regla: "formato_nit", ok, severidad: "bloqueante", detalle: ok ? "NIT con formato válido" : `NIT con formato inválido: ${ex.nit.valor}` });
  }

  // 5. Valor positivo
  if (ex.valor.valor !== null) {
    const ok = ex.valor.valor > 0;
    v.push({ regla: "valor_positivo", ok, severidad: "bloqueante", detalle: ok ? `Valor ${formatoCOP(ex.valor.valor)}` : "El valor debe ser mayor que cero" });
  }

  // 6. Otrosí / actualización: el contrato referenciado debe existir y coincidir en NIT
  if (esModificacion) {
    v.push({
      regla: "referencia_existe", ok: !!ctx.existente, severidad: "bloqueante",
      detalle: ctx.existente ? `Referencia a ${ctx.existente.id_contrato}` : "No se encontró el contrato referenciado en el maestro",
    });
    if (ctx.existente && ex.nit.valor !== null) {
      const ok = ctx.existente.nit === ex.nit.valor;
      v.push({ regla: "nit_coincide", ok, severidad: "bloqueante", detalle: ok ? "NIT coincide con el maestro" : `NIT ${ex.nit.valor} no coincide con ${ctx.existente.nit}` });
    }
  }

  // 7. Coherencia de fechas (con lo que quedaría efectivo tras la operación)
  const inicio = ex.fechaInicio.valor ?? ctx.existente?.fecha_inicio ?? null;
  const fin = ex.fechaFin.valor ?? ctx.existente?.fecha_fin ?? null;
  if (inicio && fin) {
    const ok = fin > inicio;
    v.push({ regla: "fechas_coherentes", ok, severidad: "bloqueante", detalle: ok ? `Vigencia ${inicio} → ${fin}` : `Fecha fin (${fin}) no es posterior al inicio (${inicio})` });
  }

  // 8. Duplicados
  const dup = buscarDuplicado(ctx, repo);
  v.push({
    regla: "no_duplicado", ok: !dup, severidad: "bloqueante",
    detalle: dup ? `Ya existe en el maestro como ${dup}` : "No existe un registro equivalente",
  });

  // 9. Confianza mínima en los campos que se usarían
  const bajos = (["idContrato", "cliente", "nit", "valor", "fechaInicio", "fechaFin"] as const)
    .filter((k) => ex[k].valor !== null && ex[k].confianza < cfg.umbralConfianza)
    .map((k) => `${k} (${ex[k].confianza.toFixed(2)})`);
  v.push({
    regla: "confianza_minima", ok: bajos.length === 0, severidad: "revision",
    detalle: bajos.length ? `Confianza por debajo de ${cfg.umbralConfianza}: ${bajos.join(", ")}` : `Todos los campos ≥ ${cfg.umbralConfianza}`,
  });

  return v;
}

/** Devuelve el id del contrato equivalente si el documento no aporta nada nuevo. */
export function buscarDuplicado(ctx: Ctx, repo: MasterRepository): string | undefined {
  const ex = ctx.extraccion;
  const tipo = ctx.clasificacion?.tipo;
  if (!ex) return undefined;

  if (tipo === "contrato") {
    return repo.all().find(
      (c) =>
        c.nit === ex.nit.valor && c.valor === ex.valor.valor &&
        c.fecha_inicio === ex.fechaInicio.valor && c.fecha_fin === ex.fechaFin.valor,
    )?.id_contrato;
  }
  if ((tipo === "otrosi" || tipo === "actualizacion") && ctx.existente) {
    const e = ctx.existente;
    const iguales =
      (ex.valor.valor === null || ex.valor.valor === e.valor) &&
      (ex.fechaInicio.valor === null || ex.fechaInicio.valor === e.fecha_inicio) &&
      (ex.fechaFin.valor === null || ex.fechaFin.valor === e.fecha_fin);
    return iguales ? e.id_contrato : undefined;
  }
  return undefined;
}
