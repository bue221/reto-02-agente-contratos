import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { archivosDelModulo } from "../../src/agent/module-bundle.ts";
import { leerPiezas } from "../../src/agent/prompt.ts";
import { UMBRAL_CONFIANZA } from "../../src/core/domain/parameters.ts";
import * as herramientasApp from "../../src/tools/contratos.ts";
import * as herramientasModulo from "../../../modulo/tools/contratos.ts";
import { RAIZ } from "../helpers.ts";

describe("módulo reutilizable (PRD 9.4)", () => {
  test("agent.md y SKILL.md están sincronizados con agent/prompt.md y el conocimiento", async () => {
    for (const [ruta, esperado] of Object.entries(await archivosDelModulo(RAIZ))) {
      expect(await readFile(join(RAIZ, ruta), "utf8"), `${ruta} desactualizado: ejecuta bun run sync:module`).toBe(esperado);
    }
  });

  test("agent.md declara modo primario sin permisos de edición ni shell", async () => {
    const agente = await readFile(join(RAIZ, "modulo", "agent.md"), "utf8");
    expect(agente).toMatch(/^---\n[\s\S]*mode: primary\npermission:\n {2}edit: deny\n {2}bash: deny\n---\n/);
  });

  test("las herramientas del módulo son las mismas instancias que usa la app", () => {
    expect(herramientasModulo.herramientas).toBe(herramientasApp.herramientas);
    expect(herramientasModulo.registrar).toBe(herramientasApp.registrar);
  });

  test("el conocimiento cita el mismo umbral de confianza que el código", async () => {
    const { conocimiento } = await leerPiezas(RAIZ);
    expect(conocimiento).toContain(`confianza < ${UMBRAL_CONFIANZA}`);
  });
});
