import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  getOrCreateThreadId,
  resetThreadId,
  type BuzonState,
  type CampoEditable,
  type Contrato,
  type Propuesta,
} from "./api";
import { PropuestaCard, ResolucionCard } from "./PropuestaCard";
import { BuzonView } from "./views/BuzonView";
import { MaestroView } from "./views/MaestroView";

type Msg = { role: "user" | "assistant"; text: string; propuestaIds?: string[] };
type Tab = "buzon" | "bandeja" | "maestro" | "chat";

const SECCIONES: Record<Tab, { titulo: string; descripcion: string }> = {
  buzon: {
    titulo: "Buzón",
    descripcion: "Correos entrantes. Analízalos y revisa paso a paso qué entendió el agente.",
  },
  bandeja: {
    titulo: "Bandeja de aprobación",
    descripcion:
      "El agente recomienda; tú decides. Las reglas TypeScript validan de nuevo antes de ejecutar.",
  },
  maestro: {
    titulo: "Maestro de contratos",
    descripcion: "Registro simulado de SharePoint. Nada entra aquí sin una aprobación humana.",
  },
  chat: {
    titulo: "Chat con el agente",
    descripcion: "Pregunta por el buzón, las propuestas o los vencimientos. El agente no aprueba.",
  },
};

const ICONOS: Record<Tab, string> = {
  buzon: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  bandeja: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  maestro: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M3 15h18M9 3v18",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
};

function Icono({ tab }: { tab: Tab }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONOS[tab]} />
    </svg>
  );
}

const BIENVENIDA: Msg = {
  role: "assistant",
  text:
    "Soy la recepción de contratos. Analizo y te recomiendo; tú apruebas o rechazas en la bandeja.\n" +
    'Prueba: "procesa msg-006", "qué tengo por aprobar", "qué contratos tengo".',
};

export function App() {
  const [tab, setTab] = useState<Tab>("buzon");
  const [threadId, setThreadId] = useState(getOrCreateThreadId);
  const [messages, setMessages] = useState<Msg[]>([BIENVENIDA]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [buzon, setBuzon] = useState<BuzonState | null>(null);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [provider, setProvider] = useState("…");
  const [aprobador, setAprobador] = useState(() => localStorage.getItem("contratos.aprobador") ?? "");
  const [seleccionado, setSeleccionado] = useState<string | null>("msg-001");
  const [analizando, setAnalizando] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null);
  // Cambia tras cada refresh para que el detalle del correo se recargue.
  const [version, setVersion] = useState(0);
  const detenerRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const pendientes = propuestas.filter((p) => p.estado === "PENDIENTE");
  const resueltas = propuestas
    .filter((p) => p.resolucion)
    .sort((a, b) => (b.resolucion!.resueltaEn > a.resolucion!.resueltaEn ? 1 : -1));

  async function refresh() {
    const [b, c, p, h] = await Promise.all([
      api.buzon(),
      api.contratos(),
      api.propuestas(),
      api.health(),
    ]);
    setBuzon(b);
    setContratos(c.contratos);
    setPropuestas(p.propuestas);
    setProvider(h.llm?.provider ?? "n/a");
    setVersion((v) => v + 1);
  }

  useEffect(() => {
    refresh()
      .catch((e) => setError(String((e as Error).message ?? e)))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, tab]);

  useEffect(() => {
    localStorage.setItem("contratos.aprobador", aprobador);
  }, [aprobador]);

  function decir(...nuevos: Msg[]) {
    setMessages((m) => [...m, ...nuevos]);
  }

  async function conBusy(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    decir({ role: "user", text: message });
    await conBusy(async () => {
      const res = await api.chatSync(threadId, message);
      decir({ role: "assistant", text: res.reply, propuestaIds: res.propuestaIds ?? [] });
      await refresh();
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await send(input);
  }

  async function analizar(id: string) {
    setAnalizando(id);
    try {
      await conBusy(async () => {
        await api.analizar(id);
        await refresh();
      });
    } finally {
      setAnalizando(null);
    }
  }

  /** Procesa los correos sin analizar uno a uno; la UI se actualiza tras cada uno. */
  async function analizarTodo() {
    const ids = (buzon?.correos ?? []).filter((c) => c.estado === "SIN_ANALIZAR").map((c) => c.id);
    if (!ids.length) return;
    detenerRef.current = false;
    setBusy(true);
    setError(null);
    try {
      for (const [i, id] of ids.entries()) {
        if (detenerRef.current) break;
        setProgreso({ hechos: i, total: ids.length });
        setAnalizando(id);
        setSeleccionado(id);
        try {
          await api.analizar(id);
        } catch (e) {
          setError(`Falló el análisis de ${id}: ${(e as Error).message}`);
          break;
        }
        await refresh();
      }
    } finally {
      setAnalizando(null);
      setProgreso(null);
      setBusy(false);
    }
  }

  const quien = () => aprobador.trim() || "humano";

  // Las tarjetas manejan su propio error (motivos de bloqueo); aquí solo propagamos.
  async function aprobar(
    id: string,
    correcciones: Partial<Record<CampoEditable, string>>,
    comentario: string,
  ) {
    const res = await api.aprobar(id, {
      aprobador: quien(),
      ...(Object.keys(correcciones).length ? { correcciones } : {}),
      ...(comentario.trim() ? { comentario: comentario.trim() } : {}),
    });
    decir({ role: "assistant", text: `Decisión humana aplicada.\n${res.texto}` });
    await refresh();
  }

  async function rechazar(id: string, comentario: string) {
    const res = await api.rechazar(id, {
      aprobador: quien(),
      ...(comentario.trim() ? { comentario: comentario.trim() } : {}),
    });
    decir({ role: "assistant", text: `Decisión humana aplicada.\n${res.texto}` });
    await refresh();
  }

  async function onReset() {
    detenerRef.current = true;
    await conBusy(async () => {
      await api.reset();
      setThreadId(resetThreadId());
      setMessages([{ role: "assistant", text: "Demo reiniciada: maestro, buzón y bandeja vuelven al seed." }]);
      setSeleccionado("msg-001");
      await refresh();
    });
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "buzon", label: "Buzón", count: buzon?.pendientes },
    { id: "bandeja", label: "Bandeja de aprobación", count: pendientes.length },
    { id: "maestro", label: "Maestro CSV", count: contratos.length },
    { id: "chat", label: "Chat" },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <div>
            <p className="brand-name">Contratos</p>
            <p className="brand-sub">Agente de recepción</p>
          </div>
        </div>

        <nav className="nav" role="tablist" aria-orientation="vertical">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`nav-item ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <Icono tab={t.id} />
              <span className="nav-label">{t.label}</span>
              {t.count !== undefined ? <span className="count">{t.count}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="status">
            <span className={`status-dot ${provider === "n/a" ? "off" : ""}`} />
            LLM · {provider}
          </span>
          <label className="approver-field">
            <span>Aprobador</span>
            <input
              className="approver"
              value={aprobador}
              onChange={(e) => setAprobador(e.target.value)}
              placeholder="Tu nombre"
            />
          </label>
          <button type="button" className="ghost" onClick={onReset} disabled={busy && !progreso}>
            Reiniciar demo
          </button>
        </div>
      </aside>

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

        {tab === "buzon" && buzon ? (
          <BuzonView
            correos={buzon.correos}
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

        {tab === "bandeja" ? (
          <div className="layout">
            <section className="panel inbox">
              <div className="panel-head">
                <h2>
                  Por aprobar <span className="count">{pendientes.length}</span>
                </h2>
              </div>
              <div className="cards">
                {pendientes.length ? (
                  pendientes.map((p) => (
                    <PropuestaCard
                      key={`${p.msgId}-${p.creadaEn}`}
                      propuesta={p}
                      disabled={busy}
                      onAprobar={aprobar}
                      onRechazar={rechazar}
                    />
                  ))
                ) : (
                  <p className="empty">
                    Sin recomendaciones pendientes. Analiza correos desde el Buzón o pídeselo al chat.
                  </p>
                )}
              </div>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>
                  Decisiones tomadas <span className="count muted-count">{resueltas.length}</span>
                </h2>
              </div>
              <div className="cards">
                {resueltas.length ? (
                  resueltas.map((p) => <ResolucionCard key={p.msgId} propuesta={p} />)
                ) : (
                  <p className="empty">
                    Aquí aparecen las tarjetas después de tu decisión: qué recomendó el agente, qué
                    decidiste y qué se ejecutó.
                  </p>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {tab === "maestro" ? <MaestroView contratos={contratos} propuestas={propuestas} /> : null}

        {tab === "chat" ? (
          <section className="panel chat">
            <div className="panel-head">
              <h2>Conversación</h2>
              <span className="mono muted small">thread {threadId.slice(0, 8)}</span>
            </div>
            <div className="messages">
              {messages.map((m, i) => (
                <div key={`${m.role}-${i}`} className={`turn ${m.role}`}>
                  <div className={`bubble ${m.role}`}>{m.text}</div>
                  {m.propuestaIds?.length ? (
                    <div className="chat-cards">
                      {m.propuestaIds.map((id) => {
                        const p = propuestas.find((x) => x.msgId === id);
                        if (!p) return null;
                        return p.estado === "PENDIENTE" ? (
                          <PropuestaCard
                            key={id}
                            propuesta={p}
                            disabled={busy}
                            onAprobar={aprobar}
                            onRechazar={rechazar}
                          />
                        ) : (
                          <ResolucionCard key={id} propuesta={p} />
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
              {busy && !progreso ? (
                <div className="bubble assistant typing" aria-label="El agente está escribiendo">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
            <form className="composer" onSubmit={onSubmit}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder='Ej: "procesa msg-006"'
                disabled={busy}
                aria-label="Mensaje"
              />
              <button type="submit" disabled={busy || !input.trim()}>
                Enviar
              </button>
            </form>
          </section>
        ) : null}
      </main>
    </div>
  );
}
