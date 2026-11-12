/**
 * Coordina el acceso a `out/`: turnos del chat y acciones de la bandeja lo comparten;
 * el reinicio de la demo lo toma en exclusiva, espera a que terminen los que están en curso
 * y retiene los nuevos hasta acabar.
 */
export class AccesoOut {
  #activos = 0;
  #exclusivo: Promise<void> | null = null;
  #alVaciar: (() => void)[] = [];

  async compartido<T>(tarea: () => Promise<T>): Promise<T> {
    while (this.#exclusivo) await this.#exclusivo;
    this.#activos += 1;
    try {
      return await tarea();
    } finally {
      this.#activos -= 1;
      if (this.#activos === 0) for (const avisar of this.#alVaciar.splice(0)) avisar();
    }
  }

  async exclusivo<T>(tarea: () => Promise<T>): Promise<T> {
    while (this.#exclusivo) await this.#exclusivo;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#exclusivo = promise;
    try {
      if (this.#activos > 0) await new Promise<void>((avisar) => this.#alVaciar.push(avisar));
      return await tarea();
    } finally {
      this.#exclusivo = null;
      resolve();
    }
  }
}
