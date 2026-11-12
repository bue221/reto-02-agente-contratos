import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { type Salud, type TurnoSesion, enviarMensaje, obtenerSalud, obtenerSesion } from "../api";
import { ListaDeLlamadas } from "./LlamadaHerramienta";
import { PanelMaestro } from "./PanelMaestro";
import { TextoMarkdown } from "./TextoMarkdown";

const CLAVE_SESION = "contratos.sessionId";
const PROMPT_DEMO =
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.";
const MENSAJE_CONFIRMO = "Confirmo los valores mostrados.";

const idNuevo = (): string => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function sesionGuardada(): string {
  const guardada = localStorage.getItem(CLAVE_SESION);
  if (guardada) return guardada;
  const nueva = idNuevo();
  localStorage.setItem(CLAVE_SESION, nueva);
  return nueva;
}

function Turno({ turno }: { turno: TurnoSesion }) {
  const { respuesta } = turno;
  return (
    <>
      <div className="burbuja usuario">{turno.usuario}</div>
      <ListaDeLlamadas llamadas={respuesta.toolCalls} />
      <div className={`burbuja agente ${respuesta.needsConfirmation ? "pide-confirmacion" : ""}`}>
        {respuesta.needsConfirmation && <div className="marca-confirmacion">Esperando tu confirmación</div>}
        <TextoMarkdown texto={respuesta.reply} />
      </div>
    </>
  );
}

function Cabecera({ salud, sessionId, onNueva }: { salud: Salud | null; sessionId: string; onNueva: () => void }) {
  return (
    <header className="cabecera">
      <div>
        <h1>Registro de contratos vigentes</h1>
        <p className="ayuda">
          Sesión <code>{sessionId}</code>
        </p>
      </div>
      <div className="cabecera-acciones">
        <span className={`proveedor ${salud?.provider ?? "desconocido"}`}>{salud ? `${salud.provider} · ${salud.model}` : "backend sin conexión"}</span>
        <button type="button" className="secundario" onClick={onNueva}>
          Nueva sesión
        </button>
      </div>
    </header>
  );
}

export function ChatApp() {
  const [sessionId, setSessionId] = useState(sesionGuardada);
  const [turnos, setTurnos] = useState<TurnoSesion[]>([]);
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [salud, setSalud] = useState<Salud | null>(null);
  const [texto, setTexto] = useState("");
  const [version, setVersion] = useState(0);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    obtenerSalud().then(setSalud, () => setSalud(null));
  }, []);

  useEffect(() => {
    obtenerSesion(sessionId).then(
      (sesion) => setTurnos(sesion?.turnos ?? []),
      (falla: unknown) => setError(falla instanceof Error ? falla.message : String(falla)),
    );
  }, [sessionId]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turnos, pendiente]);

  const enviar = useCallback(
    async (mensaje: string) => {
      const limpio = mensaje.trim();
      if (!limpio || pendiente) return;
      setPendiente(limpio);
      setError(null);
      setTexto("");
      try {
        const respuesta = await enviarMensaje(sessionId, limpio);
        setTurnos((previos) => [...previos, { ts: new Date().toISOString(), usuario: limpio, respuesta }]);
      } catch (falla) {
        setError(falla instanceof Error ? falla.message : String(falla));
        setTexto(limpio);
      } finally {
        setPendiente(null);
        setVersion((v) => v + 1);
      }
    },
    [pendiente, sessionId],
  );

  const nuevaSesion = (): void => {
    const nueva = idNuevo();
    localStorage.setItem(CLAVE_SESION, nueva);
    setSessionId(nueva);
    setError(null);
  };

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
    <div className="app">
      <Cabecera salud={salud} sessionId={sessionId} onNueva={nuevaSesion} />
      <div className="cuerpo">
        <main className="chat">
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
                <div className="pensando" role="status">
                  <span className="punto" />
                  <span className="punto" />
                  <span className="punto" />
                  El agente está pensando y llamando herramientas…
                </div>
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
              <strong>El agente necesita tu confirmación antes de registrar.</strong> Revisa los campos y confirma, o escribe la corrección.
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
        </main>
        <PanelMaestro version={version} />
      </div>
    </div>
  );
}
