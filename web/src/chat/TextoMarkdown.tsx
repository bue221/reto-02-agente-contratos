import type { ReactNode } from "react";

/**
 * Subconjunto de Markdown que usa el agente (tablas, títulos, listas, negrita, código).
 * Sin dependencias y sin HTML crudo: React escapa todo el texto, así el modelo no puede inyectar markup.
 */

type Bloque =
  | { tipo: "tabla"; filas: string[][] }
  | { tipo: "titulo"; texto: string }
  | { tipo: "lista"; items: string[] }
  | { tipo: "separador" }
  | { tipo: "parrafo"; lineas: string[] };

const celdas = (linea: string): string[] =>
  linea
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((celda) => celda.trim());

const esSeparadorDeTabla = (linea: string): boolean => /^\|?\s*:?-{2,}/.test(linea.trim());
const ITEM = /^\s*[-*]\s+/;

function agregarLinea(bloques: Bloque[], linea: string): void {
  const ultimo = bloques.at(-1);
  const recortada = linea.trim();
  if (recortada.startsWith("|")) {
    if (esSeparadorDeTabla(recortada)) return;
    if (ultimo?.tipo === "tabla") ultimo.filas.push(celdas(recortada));
    else bloques.push({ tipo: "tabla", filas: [celdas(recortada)] });
  } else if (/^#{1,6}\s/.test(recortada)) {
    bloques.push({ tipo: "titulo", texto: recortada.replace(/^#+\s*/, "") });
  } else if (/^(-{3,}|\*{3,})$/.test(recortada)) {
    bloques.push({ tipo: "separador" });
  } else if (ITEM.test(linea)) {
    const item = linea.replace(ITEM, "");
    if (ultimo?.tipo === "lista") ultimo.items.push(item);
    else bloques.push({ tipo: "lista", items: [item] });
  } else if (ultimo?.tipo === "parrafo") {
    ultimo.lineas.push(recortada);
  } else {
    bloques.push({ tipo: "parrafo", lineas: [recortada] });
  }
}

/** Cada grupo separado por una línea en blanco arma sus propios bloques: nunca se fusiona con el anterior. */
function bloquesDe(texto: string): Bloque[] {
  return texto.split(/\n\s*\n/).flatMap((grupo) => {
    const bloques: Bloque[] = [];
    for (const linea of grupo.split("\n")) if (linea.trim()) agregarLinea(bloques, linea);
    return bloques;
  });
}

function enLinea(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((parte, i) => {
    if (parte.startsWith("**") && parte.endsWith("**") && parte.length > 4) return <strong key={i}>{parte.slice(2, -2)}</strong>;
    if (parte.startsWith("`") && parte.endsWith("`") && parte.length > 2) return <code key={i}>{parte.slice(1, -1)}</code>;
    return parte;
  });
}

function Tabla({ filas }: { filas: string[][] }) {
  const [encabezado = [], ...cuerpo] = filas;
  return (
    <div className="md-tabla">
      <table>
        <thead>
          <tr>{encabezado.map((celda, i) => <th key={i}>{enLinea(celda)}</th>)}</tr>
        </thead>
        <tbody>
          {cuerpo.map((fila, i) => (
            <tr key={i}>{fila.map((celda, j) => <td key={j}>{enLinea(celda)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BloqueVista({ bloque }: { bloque: Bloque }) {
  switch (bloque.tipo) {
    case "tabla":
      return <Tabla filas={bloque.filas} />;
    case "titulo":
      return <h4>{enLinea(bloque.texto)}</h4>;
    case "lista":
      return <ul>{bloque.items.map((item, i) => <li key={i}>{enLinea(item)}</li>)}</ul>;
    case "separador":
      return <hr />;
    case "parrafo":
      return <p>{bloque.lineas.flatMap((linea, i) => (i === 0 ? enLinea(linea) : [<br key={`br-${i}`} />, ...enLinea(linea)]))}</p>;
  }
}

export function TextoMarkdown({ texto }: { texto: string }) {
  return (
    <div className="md">
      {bloquesDe(texto).map((bloque, i) => (
        <BloqueVista key={i} bloque={bloque} />
      ))}
    </div>
  );
}
