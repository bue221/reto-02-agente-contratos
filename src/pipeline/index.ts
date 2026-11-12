import type { Config } from "../config.ts";
import type { MasterRepository } from "../adapters/master-repo.ts";
import type { LLM } from "../llm/index.ts";
import type { Comercial, Contrato, Ctx, Decision } from "../types.ts";
import { leerMensaje } from "../adapters/mailbox.ts";
import { resolverAutor } from "../adapters/comerciales.ts";
import { archivar, auditar } from "../adapters/archive.ts";
import { buscarDuplicado, evaluarReglas } from "../rules.ts";

export interface Deps {
  cfg: Config;
  repo: MasterRepository;
  llm: LLM;
  comerciales: Comercial[];
}

type Paso = (ctx: Ctx, deps: Deps) => Promise<void>;

// ───────────────────────── Pasos ─────────────────────────
// Cada paso hace UNA cosa y deja su resultado en el contexto. El orden lo fija el código (PIPELINE),
// no el LLM: así el flujo es predecible, auditable y testeable.

const cargar: Paso = async (ctx, { cfg }) => {
  ctx.correo = leerMensaje(cfg, ctx.msgId);
  ctx.log.push(`Correo de ${ctx.correo.de}: "${ctx.correo.asunto}" (${ctx.correo.adjuntos.length} adjunto/s)`);
};

const clasificar: Paso = async (ctx, { llm }) => {
  ctx.clasificacion = await llm.clasificar(ctx.correo!);
  ctx.log.push(`Clasificado como ${ctx.clasificacion.tipo} (${ctx.clasificacion.confianza.toFixed(2)}): ${ctx.clasificacion.razon}`);
};

const extraer: Paso = async (ctx, { llm }) => {
  const tipo = ctx.clasificacion!.tipo;
  if (!["contrato", "otrosi", "actualizacion"].includes(tipo)) return;
  const patron = tipo === "otrosi" ? /otros[ií]/i : /contrato/i;
  const adj = ctx.correo!.adjuntos.find((a) => patron.test(a.nombre)) ?? ctx.correo!.adjuntos[0];
  if (!adj) return;
  ctx.documento = adj.nombre;
  ctx.extraccion = await llm.extraer(adj.texto, tipo);
  ctx.log.push(`Datos extraídos de ${adj.nombre}`);
};

const resolverAutoria: Paso = async (ctx, { comerciales }) => {
  ctx.autor = resolverAutor(comerciales, ctx.correo!.de);
};

const buscarExistente: Paso = async (ctx, { repo }) => {
  const tipo = ctx.clasificacion!.tipo;
  if (tipo !== "otrosi" && tipo !== "actualizacion") return;
  const c = ctx.correo!;
  const id = ctx.extraccion?.idContrato.valor ?? `${c.asunto} ${c.cuerpo}`.match(/\bC-\d{3}\b/i)?.[0]?.toUpperCase();
  if (id) ctx.existente = repo.findById(id);
  else if (ctx.extraccion?.nit.valor) {
    const porNit = repo.findByNit(ctx.extraccion.nit.valor);
    if (porNit.length === 1) ctx.existente = porNit[0];
  }
  if (ctx.existente) ctx.log.push(`Contrato referenciado: ${ctx.existente.id_contrato}`);
};

const validar: Paso = async (ctx, { repo, cfg }) => {
  ctx.validaciones = evaluarReglas(ctx, repo, cfg);
  ctx.duplicadoDe = buscarDuplicado(ctx, repo);
};

const decidir: Paso = async (ctx) => {
  const fallas = ctx.validaciones.filter((x) => !x.ok);
  const falla = (r: string) => fallas.find((x) => x.regla === r);
  const motivos = (xs: typeof fallas) => xs.map((x) => x.detalle);
  const tipo = ctx.clasificacion!.tipo;

  let decision: Decision;
  if (falla("tipo_procesable")) { decision = "RECHAZAR"; ctx.motivos = motivos([falla("tipo_procesable")!]); }
  else if (falla("autor_resuelto")) { decision = "RECHAZAR"; ctx.motivos = motivos([falla("autor_resuelto")!]); }
  else if (falla("no_duplicado")) { decision = "DUPLICADO"; ctx.motivos = motivos([falla("no_duplicado")!]); }
  else if (fallas.some((x) => x.severidad === "bloqueante")) { decision = "RECHAZAR"; ctx.motivos = motivos(fallas.filter((x) => x.severidad === "bloqueante")); }
  else if (fallas.length) { decision = "REVISION_HUMANA"; ctx.motivos = motivos(fallas); }
  else { decision = tipo === "contrato" ? "REGISTRAR_NUEVO" : "ACTUALIZAR"; ctx.motivos = ["Todas las validaciones pasaron"]; }
  ctx.decision = decision;
};

const ejecutar: Paso = async (ctx, { repo, cfg }) => {
  const ex = ctx.extraccion;
  const correo = ctx.correo!;
  const estadoPara = (fin: string): Contrato["estado"] => (fin >= cfg.hoy ? "ACTIVO" : "VENCIDO");

  switch (ctx.decision) {
    case "REGISTRAR_NUEVO": {
      const id = repo.nextId();
      const archivos = archivar(cfg, correo, `archivo/${id}`);
      repo.insert({
        id_contrato: id, cliente: ex!.cliente.valor!, nit: ex!.nit.valor!, valor: ex!.valor.valor!,
        moneda: "COP", fecha_inicio: ex!.fechaInicio.valor!, fecha_fin: ex!.fechaFin.valor!,
        comercial_email: ctx.autor!.email, estado: estadoPara(ex!.fechaFin.valor!),
        archivo: archivos[0] ?? "", actualizado_en: cfg.hoy,
      });
      ctx.contratoId = id;
      ctx.archivos = archivos;
      ctx.log.push(`Registrado ${id} en el maestro`);
      break;
    }
    case "ACTUALIZAR": {
      const e = ctx.existente!;
      const nuevos: Partial<Contrato> = {};
      const candidatos: [keyof Contrato, unknown][] = [
        ["valor", ex!.valor.valor], ["fecha_inicio", ex!.fechaInicio.valor], ["fecha_fin", ex!.fechaFin.valor],
      ];
      for (const [k, nuevo] of candidatos) {
        if (nuevo !== null && nuevo !== e[k]) {
          ctx.cambios[k] = { antes: e[k], despues: nuevo };
          (nuevos as Record<string, unknown>)[k] = nuevo;
        }
      }
      const finEfectivo = (nuevos.fecha_fin as string | undefined) ?? e.fecha_fin;
      const archivos = archivar(cfg, correo, `archivo/${e.id_contrato}`);
      repo.update(e.id_contrato, { ...nuevos, estado: estadoPara(finEfectivo), actualizado_en: cfg.hoy });
      ctx.contratoId = e.id_contrato;
      ctx.archivos = archivos;
      ctx.log.push(`Actualizado ${e.id_contrato}: ${Object.keys(ctx.cambios).join(", ")}`);
      break;
    }
    case "DUPLICADO":
      ctx.archivos = archivar(cfg, correo, "duplicados");
      ctx.contratoId = ctx.duplicadoDe;
      ctx.log.push("Duplicado: no se modificó el maestro");
      break;
    case "REVISION_HUMANA":
      ctx.archivos = archivar(cfg, correo, "revision");
      ctx.log.push("Enviado a revisión humana: no se modificó el maestro");
      break;
    default:
      ctx.archivos = archivar(cfg, correo, "rechazados");
      ctx.log.push("Rechazado: no se modificó el maestro");
  }
};

const registrarAuditoria: Paso = async (ctx, { cfg, llm }) => {
  auditar(cfg, {
    ts: new Date().toISOString(), msgId: ctx.msgId, modelo: llm.nombre,
    tipo: ctx.clasificacion?.tipo, decision: ctx.decision, contratoId: ctx.contratoId ?? null,
    motivos: ctx.motivos, cambios: ctx.cambios,
    validaciones: ctx.validaciones.map((x) => ({ regla: x.regla, ok: x.ok })),
    extraccion: ctx.extraccion ?? null, archivos: ctx.archivos,
  });
};

/** El orden de los pasos es fijo y vive aquí. */
export const PIPELINE: Paso[] = [
  cargar, clasificar, extraer, resolverAutoria, buscarExistente, validar, decidir, ejecutar, registrarAuditoria,
];

export async function procesarMensaje(msgId: string, deps: Deps): Promise<Ctx> {
  const ctx: Ctx = { msgId, validaciones: [], motivos: [], cambios: {}, archivos: [], log: [] };
  for (const paso of PIPELINE) {
    try {
      await paso(ctx, deps);
    } catch (e) {
      // Ante cualquier error inesperado: no escribir nada y dejar el caso para una persona.
      ctx.decision = "REVISION_HUMANA";
      ctx.motivos = [`Error en el paso "${paso.name}": ${(e as Error).message}`];
      ctx.log.push(ctx.motivos[0]);
      try { auditar(deps.cfg, { ts: new Date().toISOString(), msgId, decision: ctx.decision, motivos: ctx.motivos }); } catch { /* noop */ }
      break;
    }
  }
  return ctx;
}
