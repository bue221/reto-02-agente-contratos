import type { CorreccionesVisibles, RespuestaBandeja } from "../api";
import { PropuestaCard, ResolucionCard } from "../PropuestaCard";

type Props = {
  bandeja: RespuestaBandeja;
  busy: boolean;
  onAprobar: (id: string, correcciones: CorreccionesVisibles) => Promise<void>;
  onRechazar: (id: string, motivo: string) => Promise<void>;
};

/** Lo que espera una decisión humana a la izquierda; lo ya decidido (aquí o en el chat) a la derecha. */
export function BandejaView({ bandeja, busy, onAprobar, onRechazar }: Props) {
  return (
    <div className="layout">
      <section className="panel inbox">
        <div className="panel-head">
          <h2>
            Por aprobar <span className="count">{bandeja.pendientes.length}</span>
          </h2>
        </div>
        <div className="cards">
          {bandeja.pendientes.length ? (
            bandeja.pendientes.map((item) => <PropuestaCard key={`${item.mensaje.id}-${item.desde}`} item={item} disabled={busy} onAprobar={onAprobar} onRechazar={onRechazar} />)
          ) : (
            <p className="empty">Nada espera tu aprobación. Analiza correos desde el Buzón o pídeselo al chat: lo dudoso aparece aquí.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>
            Decisiones tomadas <span className="count muted-count">{bandeja.resueltas.length}</span>
          </h2>
        </div>
        <div className="cards">
          {bandeja.resueltas.length ? (
            bandeja.resueltas.map((decision) => <ResolucionCard key={`${decision.mensaje_id}-${decision.ts}`} decision={decision} />)
          ) : (
            <p className="empty">Aquí quedan las decisiones humanas: quién confirmó o rechazó, qué corrigió y qué se escribió en el maestro.</p>
          )}
        </div>
      </section>
    </div>
  );
}
