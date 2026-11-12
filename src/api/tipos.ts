/**
 * Contrato de la API del chat. Sin imports a propósito: el front lo importa como `import type`
 * y así backend y front no pueden divergir.
 */

export interface LlamadaVisible {
  nombre: string;
  args: Record<string, unknown>;
  ok: boolean;
  resumen: string;
}

export interface RespuestaChat {
  reply: string;
  toolCalls: LlamadaVisible[];
  needsConfirmation: boolean;
}

export interface PeticionChat {
  sessionId: string;
  message: string;
}

export interface TurnoSesion {
  ts: string;
  usuario: string;
  respuesta: RespuestaChat;
}

export interface SesionPublica {
  id: string;
  creada: string;
  actualizada: string;
  tokens: { entrada: number; salida: number };
  /** Mensajes cuyo registro espera una confirmación explícita del usuario (CA3). */
  pendientesConfirmacion: string[];
  turnos: TurnoSesion[];
}

export interface Salud {
  ok: true;
  provider: string;
  model: string;
}

export interface ErrorApi {
  ok: false;
  error: { codigo: string; mensaje: string };
}
