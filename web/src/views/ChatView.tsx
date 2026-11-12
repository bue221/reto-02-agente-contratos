import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { ErrorDeApi, type TurnoSesion, enviarMensajeEnVivo, obtenerSesion } from "../lib/api";
import { mensajeDeFalla } from "../lib/format";
import { PROGRESO_INICIAL, type ProgresoTurno, aplicarEvento } from "../lib/turn-progress";
import { ToolCallList } from "../components/ToolCallList";
import { MarkdownText } from "../components/MarkdownText";
import { TurnProgress } from "../components/TurnProgress";

const PROMPT_DEMO =
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.";
const MENSAJE_CONFIRMO = "Confirmo los valores mostrados.";

function Turno({ turno }: { turno: TurnoSesion }) {
  const { respuesta } = turno;
  return (
    <>
      <div className="burbuja usuario">{turno.usuario}</div>
      <ToolCallList llamadas={respuesta.toolCalls} />
      <div className={`burbuja agente ${respuesta.needsConfirmation ? "pide-confirmacion" : ""}`}>
        {respuesta.needsConfirmation && <div className="marca-confirmacion">Esperando tu confirmación</div>}
        <MarkdownText texto={respuesta.reply} />
      </div>
    </>
  );
}

type Props = {
  sessionId: string;
  onNuevaSesion: () => void;
  /** Tras cada turno: el agente pudo registrar o dejar mensajes en la bandeja. */
  onTurno: () => void;
};

/** Chat con el agente (PRD 6.1): historial, cada llamada a herramienta y el estado de confirmación resaltado. */
export function ChatView({ sessionId, onNuevaSesion, onTurno }: Props) {
  const [turnos, setTurnos] = useState<TurnoSesion[]>([]);
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<ProgresoTurno>(PROGRESO_INICIAL);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const finRef = useRef<HTMLDivElement>(null);
  const sesionActual = useRef(sessionId);

  useEffect(() => {
    sesionActual.current = sessionId;
    setTurnos([]);
    setError(null);
    obtenerSesion(sessionId).then(
      (sesion) => setTurnos(sesion?.turnos ?? []),
      (falla: unknown) => setError(mensajeDeFalla(falla)),
    );
  }, [sessionId]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turnos, pendiente, progreso]);

  const enviar = useCallback(
    async (mensaje: string) => {
      const limpio = mensaje.trim();
      if (!limpio || pendiente) return;
      setPendiente(limpio);
      setProgreso(PROGRESO_INICIAL);
      setError(null);
      setTexto("");
      // Si mientras tanto se reinició la demo o se abrió otra sesión, lo que llegue ya no pertenece a esta vista.
      const sigueVigente = (): boolean => sesionActual.current === sessionId;
      try {
        const respuesta = await enviarMensajeEnVivo(sessionId, limpio, (evento) => {
          if (sigueVigente()) setProgreso((previo) => aplicarEvento(previo, evento));
        });
        if (sigueVigente()) setTurnos((previos) => [...previos, { ts: new Date().toISOString(), usuario: limpio, respuesta }]);
      } catch (falla) {
        setError(mensajeDeFalla(falla));
        // Un turno cortado a medias pudo haberse ejecutado: no se ofrece reenviarlo tal cual.
        if (!(falla instanceof ErrorDeApi && falla.codigo === "turno_cortado")) setTexto(limpio);
      } finally {
        setPendiente(null);
        onTurno();
      }
    },
    [pendiente, sessionId, onTurno],
  );

  const alEnviar = (evento: FormEvent): void => {
    evento.preventDefault();
    void enviar(texto);
  };

  const alTeclear = (evento: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (evento.key === "Enter" && !evento.shiftKey) {
      evento.preventDefault();
      void enviar(texto);
    }
  };

  const pideConfirmacion = !pendiente && turnos.at(-1)?.respuesta.needsConfirmation === true;

  return (
    <section className="panel chat-agente">
      <div className="panel-head">
        <h2>Conversación</h2>
        <div className="head-actions">
          <span className="mono muted small">sesión {sessionId}</span>
          <button type="button" className="ghost small-btn" onClick={onNuevaSesion} disabled={pendiente !== null}>
            Nueva sesión
          </button>
        </div>
      </div>
      <div className="mensajes">
        {turnos.length === 0 && !pendiente && (
          <div className="vacio">
            <p>Pídele al agente que procese el buzón. Cada llamada a herramienta aparecerá en el chat.</p>
            <button type="button" className="sugerencia" onClick={() => void enviar(PROMPT_DEMO)}>
              {PROMPT_DEMO}
            </button>
          </div>
        )}
        {turnos.map((turno, i) => (
          <Turno key={`${turno.ts}-${i}`} turno={turno} />
        ))}
        {pendiente && (
          <>
            <div className="burbuja usuario">{pendiente}</div>
            <TurnProgress progreso={progreso} />
          </>
        )}
        {error && (
          <div className="burbuja error" role="alert">
            {error}
          </div>
        )}
        <div ref={finRef} />
      </div>
      {pideConfirmacion && (
        <div className="banner-confirmacion" role="alert">
          <span>
            <strong>El agente necesita tu confirmación antes de registrar.</strong> Revisa los campos y confirma, escribe la corrección o decide desde la Bandeja de aprobación.
          </span>
          <button type="button" onClick={() => void enviar(MENSAJE_CONFIRMO)}>
            Confirmo
          </button>
        </div>
      )}
      <form className="entrada" onSubmit={alEnviar}>
        <textarea
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          onKeyDown={alTeclear}
          placeholder={pideConfirmacion ? "Ej.: confirmo el valor 0 y la fecha fin 2027-08-31" : "Escribe un mensaje (Enter envía, Shift+Enter salto de línea)"}
          rows={2}
          disabled={pendiente !== null}
        />
        <button type="submit" disabled={pendiente !== null || !texto.trim()}>
          Enviar
        </button>
      </form>
    </section>
  );
}
