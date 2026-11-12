# Módulo reutilizable (`modulo/`)

## Qué es, en simple

La app (`api/` + `web/`) es una forma de usar el agente: con nuestro servidor y nuestro chat. `modulo/` es **otra forma de entregar el mismo agente**: sin servidor, como piezas sueltas que una plataforma de agentes ya existente (un IDE con agentes, una plataforma interna, otro orquestador) puede cargar directamente:

- **quién es el agente** → `agent.md` (el system prompt con frontmatter de permisos),
- **qué sabe** → `skill/registro-contratos/SKILL.md` (el conocimiento del proceso),
- **qué puede hacer** → `tools/recepcion.ts` (las cinco `recepcion_*` que ve el agente, que encienden el motor determinista) y `tools/contratos.ts` (las `contratos_*` del PRD que llama el motor).

No es código nuevo ni una copia: los dos Markdown se **generan** desde `agent/prompt.md` y el conocimiento de la API, y los dos archivos de `tools/` solo reexportan las herramientas de `api/`. Es el bonus del PRD §9.4 (hasta +10 puntos), que evalúa justamente que las tres piezas sean **las mismas** que usa la app. El nombre `modulo/` lo fija el PRD.

## Contenido

```
modulo/
├── agent.md                          frontmatter (description, mode: primary, permission edit/bash: deny) + system prompt
├── tools/recepcion.ts                reexporta api/src/tools/recepcion.ts: lo que debe registrar la plataforma para el agente
├── tools/contratos.ts                reexporta api/src/tools/contratos.ts y sus tipos (contrato del PRD §6.2)
└── skill/registro-contratos/SKILL.md frontmatter (name, description) + conocimiento del proceso
```

## De dónde sale cada pieza

| Archivo | Fuente | Cómo |
|---|---|---|
| `agent.md` | `agent/prompt.md` | Generado por `api/scripts/sync-module.ts`. |
| `skill/registro-contratos/SKILL.md` | `api/src/knowledge/registro-contratos.md` | Generado por `api/scripts/sync-module.ts`. |
| `tools/recepcion.ts` | `api/src/tools/recepcion.ts` | Reexport (`export { … } from "../../api/src/tools/recepcion.ts"`). |
| `tools/contratos.ts` | `api/src/tools/contratos.ts` | Reexport (`export { … } from "../../api/src/tools/contratos.ts"`). |

La plantilla de los dos Markdown (frontmatter + aviso «Generado por api/scripts/sync-module.ts: no editar a mano») vive en `api/src/agent/module-bundle.ts` (`archivosDelModulo`).

## Mantenerlo sincronizado

```bash
bun run sync:module           # regenera agent.md y SKILL.md
bun run sync:module --check   # falla (exit 1) si están desactualizados
```

- `api/tests/integration/module.test.ts` falla si divergen y verifica que `modulo/tools` expone las mismas herramientas que la app.
- CI ejecuta `bun run sync:module --check`.

**Regla**: nunca edites `modulo/agent.md` ni `SKILL.md` a mano. Edita `agent/prompt.md` o el conocimiento y regenera.

## Usarlo desde otra plataforma

Registra para el agente **solo** las de `tools/recepcion.ts`, igual que hace la app: así la plataforma tampoco puede saltarse el motor.

```ts
import { herramientas, ejecutarHerramienta } from "./modulo/tools/recepcion.ts";

for (const [nombre, h] of Object.entries(herramientas)) {
  // h.description, h.args (zod) → registrar en la plataforma
}
const json = await ejecutarHerramienta("recepcion_procesar_buzon", { hoy: "2026-09-03" }, { directory: "/ruta/al/proyecto", sessionId: "x" });
```

`ctx.directory` debe apuntar a una raíz con `fixtures/reto-02/` (o la estructura equivalente); las salidas van a `<directory>/out/`. La guarda de confirmación humana (CA3) vive en el ciclo de la app (`api/src/agent/execution.ts`): una plataforma que use el módulo debe exigir, igual, que `recepcion_responder_revision` llegue solo después de preguntar a la persona.
