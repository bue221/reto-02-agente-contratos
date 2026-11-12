import { type DecisionVisible, type FilaMaestroVisible, URL_MAESTRO_CSV } from "../api";
import { mostrarValor } from "../formato";

type Columna = keyof FilaMaestroVisible;

const COLUMNAS: readonly { columna: Columna; etiqueta: string }[] = [
  { columna: "id_contrato", etiqueta: "ID" },
  { columna: "cliente", etiqueta: "Cliente" },
  { columna: "nit_cliente", etiqueta: "NIT" },
  { columna: "pais", etiqueta: "País" },
  { columna: "valor", etiqueta: "Valor" },
  { columna: "moneda", etiqueta: "Moneda" },
  { columna: "fecha_inicio", etiqueta: "Inicio" },
  { columna: "fecha_fin", etiqueta: "Fin" },
  { columna: "estado_poliza", etiqueta: "Póliza" },
  { columna: "comercial", etiqueta: "Comercial" },
  { columna: "ruta_sharepoint", etiqueta: "Archivo" },
  { columna: "fecha_registro", etiqueta: "Registro" },
  { columna: "fuente", etiqueta: "Fuente" },
];

const SIN_CORTE: ReadonlySet<Columna> = new Set(["id_contrato", "fecha_inicio", "fecha_fin", "fecha_registro"]);

type Marca = { tipo: "nuevo" | "modificado"; decision: DecisionVisible };

/** Filas que escribió una aprobación humana (la más reciente manda). */
function marcasPorContrato(decisiones: readonly DecisionVisible[]): Map<string, Marca> {
  const marcas = new Map<string, Marca>();
  for (const decision of [...decisiones].reverse()) {
    if (!decision.id_contrato || decision.decision !== "aprobado") continue;
    if (decision.accion === "insertado") marcas.set(decision.id_contrato, { tipo: "nuevo", decision });
    if (decision.accion === "actualizado") marcas.set(decision.id_contrato, { tipo: "modificado", decision });
  }
  return marcas;
}

function Celda({ fila, columna, marca }: { fila: FilaMaestroVisible; columna: Columna; marca: Marca | undefined }) {
  const cambio = marca?.tipo === "modificado" ? marca.decision.cambios[columna] : undefined;
  const contenido = columna === "estado_poliza" ? <span className={`chip chip-poliza-${fila.estado_poliza}`}>{fila.estado_poliza}</span> : mostrarValor(fila[columna], columna === "valor" ? "valor" : undefined);
  return (
    <td className={`${cambio ? "changed" : ""} ${SIN_CORTE.has(columna) ? "nowrap" : ""}`} title={cambio ? `Antes: ${mostrarValor(cambio.antes)}` : undefined}>
      {contenido}
      {cambio ? <div className="muted small">antes {mostrarValor(cambio.antes)}</div> : null}
    </td>
  );
}

export function MaestroView({ filas, decisiones }: { filas: FilaMaestroVisible[]; decisiones: DecisionVisible[] }) {
  const marcas = marcasPorContrato(decisiones);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Contratos registrados</h2>
          <p className="muted small">
            out/sharepoint/maestro-contratos.csv · {filas.length} contratos · {marcas.size} escrito(s) por aprobaciones humanas
          </p>
        </div>
        <a className="button" href={URL_MAESTRO_CSV} download="maestro-contratos.csv">
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
              {COLUMNAS.map(({ columna, etiqueta }) => (
                <th key={columna}>{etiqueta}</th>
              ))}
              <th>Origen</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => {
              const marca = marcas.get(fila.id_contrato);
              return (
                <tr key={fila.id_contrato} className={marca ? `row-${marca.tipo}` : ""}>
                  {COLUMNAS.map(({ columna }) => (
                    <Celda key={columna} fila={fila} columna={columna} marca={marca} />
                  ))}
                  <td className="small">
                    {marca ? (
                      <>
                        {marca.tipo === "nuevo" ? "Nuevo" : "Modificado"} · {marca.decision.mensaje_id}
                        <div className="muted">por {marca.decision.aprobador}</div>
                      </>
                    ) : (
                      <span className="muted">{fila.fuente === "buzon" ? "buzón (automático)" : fila.fuente}</span>
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
