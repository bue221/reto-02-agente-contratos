import { useEffect, useState } from "react";
import { type FilaMaestro, obtenerMaestro } from "./api";

const formatoValor = (fila: FilaMaestro): string => (fila.valor === 0 ? "por demanda" : `${fila.moneda} ${fila.valor.toLocaleString("es-CO")}`);

/** Vista de solo lectura del maestro de trabajo; se recarga cuando cambia `version` (tras cada turno). */
export function PanelMaestro({ version }: { version: number }) {
  const [filas, setFilas] = useState<FilaMaestro[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    obtenerMaestro()
      .then((respuesta) => {
        setFilas(respuesta.filas);
        setError(null);
      })
      .catch((falla: unknown) => setError(falla instanceof Error ? falla.message : String(falla)));
  }, [version]);

  return (
    <aside className="panel">
      <h2>Maestro de contratos</h2>
      <p className="ayuda">out/sharepoint/maestro-contratos.csv · {filas.length} filas</p>
      {error && <p className="error-texto">{error}</p>}
      <ul className="maestro">
        {filas.map((fila) => (
          <li key={fila.id_contrato}>
            <div className="fila-titulo">
              <code>{fila.id_contrato}</code>
              <span className={`poliza ${fila.estado_poliza}`}>{fila.estado_poliza}</span>
            </div>
            <div className="fila-cliente">{fila.cliente}</div>
            <div className="fila-detalle">
              {formatoValor(fila)} · {fila.fecha_inicio} → {fila.fecha_fin}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
