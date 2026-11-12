/** CSV RFC 4180 mínimo: comillas dobles, comillas escapadas y saltos de línea dentro de celdas. */

export function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let enComillas = false;
  const cerrarFila = () => {
    fila.push(celda);
    if (fila.some((valor) => valor !== "")) filas.push(fila);
    fila = [];
    celda = "";
  };
  for (let i = 0; i < texto.length; i++) {
    const caracter = texto[i];
    if (enComillas) {
      if (caracter === '"' && texto[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (caracter === '"') enComillas = false;
      else celda += caracter;
    } else if (caracter === '"') enComillas = true;
    else if (caracter === ",") {
      fila.push(celda);
      celda = "";
    } else if (caracter === "\n") cerrarFila();
    else if (caracter !== "\r") celda += caracter;
  }
  if (celda !== "" || fila.length > 0) cerrarFila();
  return filas;
}

const escaparCelda = (celda: string): string => (/[",\n\r]/.test(celda) ? `"${celda.replace(/"/g, '""')}"` : celda);

export const serializarCsv = (filas: readonly (readonly string[])[]): string =>
  `${filas.map((fila) => fila.map(escaparCelda).join(",")).join("\n")}\n`;
