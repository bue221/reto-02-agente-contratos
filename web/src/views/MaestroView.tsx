import { CSV_URL, type Contrato, type Propuesta } from "../api";

const COLUMNAS: { key: keyof Contrato; label: string }[] = [
  { key: "id_contrato", label: "ID" },
  { key: "cliente", label: "Cliente" },
  { key: "nit", label: "NIT" },
  { key: "valor", label: "Valor" },
  { key: "moneda", label: "Moneda" },
  { key: "fecha_inicio", label: "Inicio" },
  { key: "fecha_fin", label: "Fin" },
  { key: "comercial_email", label: "Comercial" },
  { key: "estado", label: "Estado" },
  { key: "archivo", label: "Archivo" },
  { key: "actualizado_en", label: "Actualizado" },
];

type Marca = { tipo: "nuevo" | "modificado"; msgId: string; aprobador: string; cambios: Set<string> };

/** Qué filas tocó una aprobación humana: solo lectura de propuestas ya resueltas. */
function marcasPorContrato(propuestas: Propuesta[]): Map<string, Marca> {
  const marcas = new Map<string, Marca>();
  for (const p of propuestas) {
    const r = p.resolucion;
    if (!r || !r.contratoId) continue;
    if (r.decisionFinal === "REGISTRAR_NUEVO") {
      marcas.set(r.contratoId, { tipo: "nuevo", msgId: p.msgId, aprobador: r.aprobador, cambios: new Set() });
    } else if (r.decisionFinal === "ACTUALIZAR") {
      marcas.set(r.contratoId, {
        tipo: "modificado",
        msgId: p.msgId,
        aprobador: r.aprobador,
        cambios: new Set(Object.keys(r.cambios ?? {})),
      });
    }
  }
  return marcas;
}

function formatoValor(k: keyof Contrato, v: unknown): string {
  return k === "valor" && typeof v === "number" ? `$${v.toLocaleString("es-CO")}` : String(v);
}

function celda(c: Contrato, k: keyof Contrato) {
  if (k === "valor") return `$${c.valor.toLocaleString("es-CO")}`;
  if (k === "estado") return <span className={`chip chip-${c.estado}`}>{c.estado}</span>;
  return String(c[k] ?? "");
}

export function MaestroView({
  contratos,
  propuestas,
}: {
  contratos: Contrato[];
  propuestas: Propuesta[];
}) {
  const marcas = marcasPorContrato(propuestas);
  const cambiosPorContrato = new Map(
    propuestas
      .filter((p) => p.resolucion?.contratoId)
      .map((p) => [p.resolucion!.contratoId!, p.resolucion!.cambios ?? {}]),
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Contratos registrados</h2>
          <p className="muted small">
            {contratos.length} contratos · {marcas.size} tocado(s) por aprobaciones humanas
          </p>
        </div>
        <a className="button" href={CSV_URL} download="maestro-contratos.csv">
          Descargar CSV
        </a>
      </div>
      <div className="legend small">
        <span className="swatch nuevo" /> Creado al aprobar
        <span className="swatch modificado" /> Modificado al aprobar (celda cambiada resaltada)
      </div>
      <div className="table-wrap">
        <table className="master">
          <thead>
            <tr>
              {COLUMNAS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>Origen</th>
            </tr>
          </thead>
          <tbody>
            {contratos.map((c) => {
              const m = marcas.get(c.id_contrato);
              const cambios = cambiosPorContrato.get(c.id_contrato) ?? {};
              return (
                <tr key={c.id_contrato} className={m ? `row-${m.tipo}` : ""}>
                  {COLUMNAS.map(({ key }) => {
                    const ch = m?.cambios.has(key) ? cambios[key] : undefined;
                    return (
                      <td
                        key={key}
                        className={ch ? "changed" : ""}
                        title={
                          ch
                            ? `Antes: ${formatoValor(key, ch.antes)} → ahora: ${formatoValor(key, ch.despues)}`
                            : undefined
                        }
                      >
                        {celda(c, key)}
                        {ch ? <div className="muted small">antes {formatoValor(key, ch.antes)}</div> : null}
                      </td>
                    );
                  })}
                  <td className="small">
                    {m ? (
                      <>
                        {m.tipo === "nuevo" ? "Nuevo" : "Modificado"} · {m.msgId}
                        <div className="muted">por {m.aprobador}</div>
                      </>
                    ) : (
                      <span className="muted">seed</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
