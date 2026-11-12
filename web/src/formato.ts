import type { CampoContratoVisible, ClasificacionVisible, EstadoMensaje, ValorCampoVisible } from "./api";

/** Etiquetas y formatos compartidos por buzón, bandeja y maestro. */

export const UMBRAL_CONFIANZA = 0.8;

export const CAMPOS: readonly { campo: CampoContratoVisible; etiqueta: string }[] = [
  { campo: "id_contrato", etiqueta: "ID contrato" },
  { campo: "cliente", etiqueta: "Cliente" },
  { campo: "nit_cliente", etiqueta: "NIT" },
  { campo: "pais", etiqueta: "País" },
  { campo: "objeto", etiqueta: "Objeto" },
  { campo: "valor", etiqueta: "Valor" },
  { campo: "moneda", etiqueta: "Moneda" },
  { campo: "fecha_inicio", etiqueta: "Inicio" },
  { campo: "fecha_fin", etiqueta: "Fin" },
  { campo: "requiere_poliza", etiqueta: "Requiere póliza" },
  { campo: "tipo_poliza", etiqueta: "Tipo de póliza" },
];

export const ETIQUETA_CAMPO = Object.fromEntries(CAMPOS.map(({ campo, etiqueta }) => [campo, etiqueta])) as Record<CampoContratoVisible, string>;

export type EstadoVisible = EstadoMensaje | "analizando";

export const ETIQUETA_ESTADO: Record<EstadoVisible, string> = {
  pendiente: "Sin analizar",
  requiere_revision: "Por aprobar",
  registrado: "Registrado",
  actualizado: "Actualizado",
  duplicado: "Duplicado",
  rechazado: "Rechazado",
  analizando: "Analizando…",
};

export const ETIQUETA_CLASIFICACION: Record<ClasificacionVisible, string> = {
  nuevo: "Nuevo",
  actualizacion: "Actualización",
  duplicado: "Duplicado",
  rechazado: "Rechazado",
};

export function mostrarValor(valor: ValorCampoVisible | undefined, campo?: CampoContratoVisible): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (campo === "valor" && typeof valor === "number") return valor === 0 ? "0 (por demanda)" : valor.toLocaleString("es-CO");
  return String(valor);
}

export const porcentaje = (confianza: number): string => `${Math.round(confianza * 100)}%`;

export const fechaHora = (iso: string): string => new Date(iso).toLocaleString("es-CO");

export const mensajeDeFalla = (falla: unknown): string => (falla instanceof Error ? falla.message : String(falla));
