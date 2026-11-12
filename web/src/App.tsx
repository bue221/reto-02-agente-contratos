import { useCallback, useEffect, useRef, useState } from "react";
import { type CorreccionesVisibles, type FilaMaestroVisible, type RespuestaBandeja, type RespuestaBuzon, type Salud, api, obtenerSalud } from "./api";
import { ChatApp } from "./chat/ChatApp";
import { mensajeDeFalla } from "./formato";
import { BandejaView } from "./views/BandejaView";
import { BuzonView } from "./views/BuzonView";
import { MaestroView } from "./views/MaestroView";

type Tab = "buzon" | "bandeja" | "maestro" | "chat";

const SECCIONES: Record<Tab, { titulo: string; descripcion: string }> = {
  buzon: { titulo: "Buzón", descripcion: "Correos entrantes. Analízalos y revisa paso a paso qué entendió el agente." },
  bandeja: { titulo: "Bandeja de aprobación", descripcion: "El agente no registra nada dudoso: tú confirmas o corriges los campos, y el servidor vuelve a validar antes de escribir." },
  maestro: { titulo: "Maestro de contratos", descripcion: "Copia de trabajo en out/sharepoint/. Lo dudoso solo entra con una aprobación humana." },
  chat: { titulo: "Chat con el agente", descripcion: "Pídele que procese el buzón o genere alertas. Cada llamada a herramienta queda visible." },
};

const ICONOS: Record<Tab, string> = {
  buzon: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  bandeja: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  maestro: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M3 15h18M9 3v18",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
};

const CLAVE_SESION = "contratos.sessionId";
const CLAVE_APROBADOR = "contratos.aprobador";
const BANDEJA_VACIA: RespuestaBandeja = { pendientes: [], resueltas: [] };

const idSesionNueva = (): string => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function sesionGuardada(): string {
  const guardada = localStorage.getItem(CLAVE_SESION);
  if (guardada) return guardada;
  const nueva = idSesionNueva();
  localStorage.setItem(CLAVE_SESION, nueva);
  return nueva;
}

function Icono({ tab }: { tab: Tab }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONOS[tab]} />
    </svg>
  );
}

type PropsBarra = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  contadores: Partial<Record<Tab, number>>;
  salud: Salud | null;
  aprobador: string;
  onAprobador: (nombre: string) => void;
  reiniciando: boolean;
  onReiniciar: () => void;
};

const ETIQUETAS_TAB: Record<Tab, string> = { buzon: "Buzón", bandeja: "Bandeja de aprobación", maestro: "Maestro CSV", chat: "Chat" };

function BarraLateral({ tab, onTab, contadores, salud, aprobador, onAprobador, reiniciando, onReiniciar }: PropsBarra) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          C
        </span>
        <div>
          <p className="brand-name">Contratos</p>
          <p className="brand-sub">Agente de registro</p>
        </div>
      </div>
      <nav className="nav" role="tablist" aria-orientation="vertical">
        {(Object.keys(ETIQUETAS_TAB) as Tab[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => onTab(id)}>
            <Icono tab={id} />
            <span className="nav-label">{ETIQUETAS_TAB[id]}</span>
            {contadores[id] !== undefined ? <span className={`count ${id === "bandeja" && contadores[id] ? "alerta" : ""}`}>{contadores[id]}</span> : null}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span className="status">
          <span className={`status-dot ${salud ? salud.provider : "off"}`} />
          {salud ? `LLM · ${salud.provider} (${salud.model})` : "backend sin conexión"}
        </span>
        <label className="approver-field">
          <span>Aprobador</span>
          <input className="approver" value={aprobador} onChange={(evento) => onAprobador(evento.target.value)} placeholder="Tu nombre" maxLength={80} />
        </label>
        <button type="button" className="ghost danger" onClick={onReiniciar} disabled={reiniciando}>
          {reiniciando ? "Reiniciando…" : "Reiniciar demo"}
        </button>
      </div>
    </aside>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [sessionId, setSessionId] = useState(sesionGuardada);
  const [buzon, setBuzon] = useState<RespuestaBuzon | null>(null);
  const [bandeja, setBandeja] = useState<RespuestaBandeja>(BANDEJA_VACIA);
  const [filas, setFilas] = useState<FilaMaestroVisible[]>([]);
  const [salud, setSalud] = useState<Salud | null>(null);
  const [aprobador, setAprobador] = useState(() => localStorage.getItem(CLAVE_APROBADOR) ?? "");
  const [seleccionado, setSeleccionado] = useState<string | null>("msg-001");
  const [analizando, setAnalizando] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);
  const detenerRef = useRef(false);

  const refrescar = useCallback(async () => {
    try {
      const [nuevoBuzon, nuevaBandeja, maestro] = await Promise.all([api.buzon(), api.bandeja(), api.maestro()]);
      setBuzon(nuevoBuzon);
      setBandeja(nuevaBandeja);
      setFilas(maestro.filas);
      setVersion((v) => v + 1);
    } catch (falla) {
      setError(mensajeDeFalla(falla));
    }
  }, []);

  useEffect(() => {
    obtenerSalud().then(setSalud, () => setSalud(null));
    void refrescar().finally(() => setCargando(false));
  }, [refrescar]);

  useEffect(() => {
    localStorage.setItem(CLAVE_APROBADOR, aprobador);
  }, [aprobador]);

  async function conBusy(accion: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await accion();
    } catch (falla) {
      setError(mensajeDeFalla(falla));
    } finally {
      setBusy(false);
    }
  }

  async function analizar(id: string): Promise<void> {
    setAnalizando(id);
    await conBusy(async () => {
      await api.procesar(id);
      await refrescar();
    });
    setAnalizando(null);
  }

  /** Procesa uno a uno los correos sin analizar; la UI se actualiza tras cada uno y se puede detener. */
  async function analizarTodo(): Promise<void> {
    const ids = (buzon?.mensajes ?? []).filter((mensaje) => mensaje.estado === "pendiente").map((mensaje) => mensaje.id);
    detenerRef.current = false;
    await conBusy(async () => {
      for (const [i, id] of ids.entries()) {
        if (detenerRef.current) break;
        setProgreso({ hechos: i, total: ids.length });
        setAnalizando(id);
        setSeleccionado(id);
        await api.procesar(id).catch((falla: unknown) => {
          throw new Error(`Falló el análisis de ${id}: ${mensajeDeFalla(falla)}`);
        });
        await refrescar();
      }
    });
    setAnalizando(null);
    setProgreso(null);
  }

  const quien = (): string => aprobador.trim() || "analista";

  // Las tarjetas muestran su propio error; aquí solo se propaga para que lo pinten.
  async function aprobar(id: string, correcciones: CorreccionesVisibles): Promise<void> {
    await api.aprobar(id, quien(), correcciones);
    await refrescar();
  }

  async function rechazar(id: string, motivo: string): Promise<void> {
    await api.rechazar(id, quien(), motivo);
    await refrescar();
  }

  const nuevaSesion = useCallback(() => {
    const nueva = idSesionNueva();
    localStorage.setItem(CLAVE_SESION, nueva);
    setSessionId(nueva);
  }, []);

  async function reiniciar(): Promise<void> {
    if (!window.confirm("¿Reiniciar la demo? Se borran el maestro de trabajo, las decisiones, el log y las sesiones de chat, y el buzón vuelve a quedar sin procesar.")) return;
    detenerRef.current = true;
    setReiniciando(true);
    await conBusy(async () => {
      await api.reiniciarDemo();
      nuevaSesion();
      setSeleccionado("msg-001");
      await refrescar();
    });
    setReiniciando(false);
  }

  const contadores: Partial<Record<Tab, number>> = { buzon: buzon?.contadores.pendientes, bandeja: bandeja.pendientes.length, maestro: filas.length };

  return (
    <div className="shell">
      <BarraLateral tab={tab} onTab={setTab} contadores={contadores} salud={salud} aprobador={aprobador} onAprobador={setAprobador} reiniciando={reiniciando} onReiniciar={() => void reiniciar()} />
      <main className="main">
        <header className="page-head">
          <h1>{SECCIONES[tab].titulo}</h1>
          <p>{SECCIONES[tab].descripcion}</p>
        </header>
        {error ? (
          <p className="error banner" role="alert">
            <span>{error}</span>
            <button type="button" className="ghost small-btn" onClick={() => setError(null)}>
              Cerrar
            </button>
          </p>
        ) : null}
        {cargando ? <p className="meta">Cargando datos del backend…</p> : null}
        {buzon?.errores.length ? <p className="meta">Correos ilegibles: {buzon.errores.map((falla) => `${falla.id} (${falla.error})`).join(", ")}</p> : null}
        {tab === "buzon" && buzon ? (
          <BuzonView
            mensajes={buzon.mensajes}
            seleccionado={seleccionado}
            onSeleccionar={setSeleccionado}
            analizando={analizando}
            progreso={progreso}
            version={version}
            busy={busy}
            onAnalizar={analizar}
            onAnalizarTodo={analizarTodo}
            onDetener={() => {
              detenerRef.current = true;
            }}
            onAprobar={aprobar}
            onRechazar={rechazar}
          />
        ) : null}
        {tab === "bandeja" ? <BandejaView bandeja={bandeja} busy={busy} onAprobar={aprobar} onRechazar={rechazar} /> : null}
        {tab === "maestro" ? <MaestroView filas={filas} decisiones={bandeja.resueltas} /> : null}
        {/* El chat se mantiene montado: un turno en curso no se pierde al cambiar de pestaña. */}
        <div hidden={tab !== "chat"}>
          <ChatApp sessionId={sessionId} onNuevaSesion={nuevaSesion} onTurno={() => void refrescar()} />
        </div>
      </main>
    </div>
  );
}
