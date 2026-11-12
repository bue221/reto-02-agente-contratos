/**
 * Lector mínimo de Server-Sent Events sobre `fetch`: `EventSource` solo admite GET y el chat es un POST.
 * Devuelve el campo `data` de cada evento; los comentarios (`: latido`) se ignoran.
 */
export async function* datosSse(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let resto = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) return;
    // `stream: true` conserva un carácter UTF-8 partido entre dos fragmentos.
    resto += decodificador.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const bloques = resto.split("\n\n");
    resto = bloques.pop() ?? "";
    for (const bloque of bloques) {
      const datos = bloque
        .split("\n")
        .filter((linea) => linea.startsWith("data:"))
        .map((linea) => linea.slice("data:".length).replace(/^ /, ""))
        .join("\n");
      if (datos) yield datos;
    }
  }
}
