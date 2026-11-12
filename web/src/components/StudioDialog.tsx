import { useEffect, useRef, useState } from "react";
import { BASE_URL_STUDIO, DOMINIO_STUDIO, URL_AGENT_CHAT, URL_STUDIO } from "../lib/api";

type Props = { abierto: boolean; onCerrar: () => void };

/** Un valor para pegar en Studio, con copia al portapapeles (si el navegador la niega, queda seleccionable a mano). */
function ValorCopiable({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  const [estado, setEstado] = useState<"listo" | "copiado" | "fallo">("listo");

  async function copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(valor);
      setEstado("copiado");
    } catch {
      setEstado("fallo");
    }
  }

  return (
    <div className="copiable">
      <span className="small">{etiqueta}</span>
      <div className="copiable-fila">
        <code className="mono">{valor}</code>
        <button type="button" className="ghost small-btn" onClick={() => void copiar()}>
          {estado === "copiado" ? "Copiado" : "Copiar"}
        </button>
      </div>
      {estado === "fallo" ? <span className="small">No se pudo copiar: selecciónalo y cópialo a mano.</span> : null}
    </div>
  );
}

/**
 * Dos clientes de LangGraph sobre el servidor que publica el backend en `/langgraph`: Agent Chat UI entra sin pasos
 * previos; Studio dibuja el grafo, pero pide cuenta de LangSmith y permitir el dominio (solo confía en localhost).
 */
export function StudioDialog({ abierto, onCerrar }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  return (
    <dialog ref={ref} className="studio-dialog panel" onClose={onCerrar} aria-labelledby="studio-titulo">
      <div className="panel-head">
        <h2 id="studio-titulo">Probar los grafos de LangGraph</h2>
        <button type="button" className="ghost small-btn" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
      <div className="studio-cuerpo">
        <p>
          Los grafos <strong>recepcionista</strong> y <strong>motor</strong> de este agente, servidos por LangGraph sobre el mismo buzón que esta app: lo que
          registres ahí aparece en el Buzón, la Bandeja y el Maestro.
        </p>

        <section className="studio-opcion">
          <h3>Agent Chat UI · sin cuenta ni configuración</h3>
          <p>El chat de LangChain conectado al grafo recepcionista, con cada llamada a herramienta y su resultado. No dibuja el grafo.</p>
          <a className="button" href={URL_AGENT_CHAT} target="_blank" rel="noreferrer">
            Abrir Agent Chat UI
          </a>
        </section>

        <section className="studio-opcion">
          <h3>LangGraph Studio · grafo visual, paso a paso</h3>
          <ol className="studio-pasos">
            <li>
              Abre Studio e inicia sesión en LangSmith (la cuenta gratuita basta).
              <br />
              <a className="button" href={URL_STUDIO} target="_blank" rel="noreferrer">
                Abrir LangGraph Studio
              </a>
            </li>
            <li>
              Si Studio dice que el dominio <em>«is not allowed»</em>, abre <strong>Advanced Settings</strong> en esa misma pantalla y agrega este dominio a la lista de
              permitidos (Studio solo confía en localhost; se hace una vez por navegador):
              <ValorCopiable etiqueta="Dominio" valor={DOMINIO_STUDIO} />
            </li>
            <li>
              Reconecta con este Base URL. Si sigue fallando, en la portada de Studio usa <strong>Connect to local server</strong>, pega el Base URL y permite el
              dominio en Advanced Settings del mismo diálogo:
              <ValorCopiable etiqueta="Base URL" valor={BASE_URL_STUDIO} />
            </li>
          </ol>
        </section>

        <p className="small">
          Qué probar: en <strong>recepcionista</strong> (Agent Chat UI o la pestaña Chat de Studio), «Procesa el buzón de contratos con fecha de hoy 2026-09-03» y
          luego «confirmo el valor 0 y la fecha fin 2027-08-31». En Studio, <strong>motor</strong> (pestaña Graph) con la entrada{" "}
          <code className="mono">{'{ "hoy": "2026-09-03" }'}</code> se detiene en <code className="mono">revision_humana</code>, y <strong>reiniciar_demo</strong> deja el
          buzón como recién desplegado.
        </p>
      </div>
    </dialog>
  );
}
