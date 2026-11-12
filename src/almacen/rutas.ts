import { join } from "node:path";

/** Todas las rutas se resuelven desde la raíz del proyecto (`ctx.directory`), nunca absolutas en código. */
export interface Rutas {
  fixtures: string;
  buzon: string;
  maestroFixture: string;
  comerciales: string;
  out: string;
  sharepoint: string;
  maestro: string;
  historial: string;
  log: string;
  procesados: string;
  alertas: string;
}

export function rutasDelProyecto(directorio: string): Rutas {
  const fixtures = join(directorio, "fixtures", "reto-02");
  const out = join(directorio, "out");
  const sharepoint = join(out, "sharepoint");
  return {
    fixtures,
    buzon: join(fixtures, "buzon"),
    maestroFixture: join(fixtures, "maestro-contratos.csv"),
    comerciales: join(fixtures, "comerciales.json"),
    out,
    sharepoint,
    maestro: join(sharepoint, "maestro-contratos.csv"),
    historial: join(sharepoint, "historial.jsonl"),
    log: join(out, "log.jsonl"),
    procesados: join(out, "procesados.json"),
    alertas: join(out, "alertas.md"),
  };
}

const NOMBRE_SEGURO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Impide que un id de mensaje o un nombre de adjunto escape de su carpeta (`../`). */
export function segmentoSeguro(nombre: string, que: string): string {
  if (!NOMBRE_SEGURO.test(nombre) || nombre.includes("..")) throw new Error(`${que} inválido: "${nombre}"`);
  return nombre;
}
