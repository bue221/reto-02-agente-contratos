# Contribuir

Resumen operativo en [`AGENTS.md`](../../AGENTS.md). Aquí, las convenciones completas y las recetas paso a paso.

## Convenciones

### Nombres

| Qué | Idioma | Formato | Ejemplo |
|---|---|---|---|
| Carpetas y archivos del backend | inglés | `kebab-case.ts` | `api/src/application/use-cases/read-mailbox.ts` |
| Componentes React | inglés | `PascalCase.tsx`, mismo nombre que el export | `ProposalCard.tsx` → `ProposalCard` |
| Identificadores de código | español | `camelCase` / `PascalCase` | `registrarMensaje`, `AgenteContratos` |
| Campos del dominio, columnas, JSON de la API | español | `snake_case` | `id_contrato`, `requiere_revision` |
| Herramientas | español | `contratos_<export>` / `recepcion_<export>` | `contratos_registrar`, `recepcion_procesar_buzon` |
| Rutas HTTP | español | `/api/<recurso>` | `/api/bandeja/:id/aprobar` |
| Textos de UI, errores y logs | español | — | `"el mensaje no puede estar vacío"` |
| Commits | inglés | Conventional Commits | `fix(api): Return 409 when tray item is closed` |

Los identificadores y campos siguen en español porque reflejan el contrato del PRD (herramientas, esquema del maestro, API). Ver el [Glosario](Glossary.md).

### Código

- TypeScript estricto (`strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`), sin `any`.
- Lógica que puede fallar → `Resultado<T>`; nada de lanzar en herramientas ni en `ProveedorLlm`.
- Entrada externa → zod.
- Rutas desde `ctx.directory` / `rutasDelProyecto()`; ids externos por `segmentoSeguro()`.
- Parámetros de negocio solo en `api/src/core/domain/parameters.ts`.
- Importa con extensión `.ts` en el backend (`allowImportingTsExtensions`); en el front, sin extensión.
- Comentarios solo para el *por qué*.

### Capas

Las dependencias apuntan hacia adentro (ver [Arquitectura](Architecture.md#capas)): `core` no importa nada del proyecto; `infrastructure` solo `core`. Si necesitas algo de una capa exterior en una interior, invierte la dependencia (interfaz o parámetro).

### Commits

```
type(scope): Subject in present tense, capitalized, no period
```

`type`: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`. `scope` opcional: `agent`, `api`, `tools`, `core`, `web`, `llm`, `modulo`, `deploy`, `ci`.

## Recetas

### Cambiar una regla de negocio

1. Ajusta la lógica en `api/src/core/rules/` o el parámetro en `api/src/core/domain/parameters.ts`.
2. Agrega o ajusta la prueba (`api/tests/integration/tools.test.ts` para el flujo, `api/tests/unit/` si es pura).
3. Actualiza `api/src/knowledge/registro-contratos.md` para que el agente la conozca.
4. `bun run sync:module`.
5. Actualiza [Reglas de negocio](Business-Rules.md) y, si cambia un supuesto, `SOLUCION.md` §8.

### Mejorar la extracción de un campo

1. Edita `api/src/core/extraction/<campo>.ts` (`parties`, `amount`, `term`, `policy`, `prose-dates`).
2. Conserva la evidencia literal y un nivel de confianza fijo de la tabla de [Extracción](Extraction.md#niveles-de-confianza).
3. Errores de datos → `throw new ErrorExtraccion("mensaje legible")`.
4. Prueba en `api/tests/unit/extraction.test.ts` (usa `contratoModificado`).
5. `bun run demo` para confirmar que los 6 mensajes siguen dando el resultado esperado.

### Nueva herramienta

Primero decide en qué capa va (ver [Arquitectura → Dos grafos](Architecture.md#dos-grafos-la-recepcionista-y-el-motor)):

- **Un paso del proceso** (algo que el motor debe ejecutar siempre en un orden fijo) → `api/src/tools/contratos.ts` y un nodo en `api/src/application/workflows/contract-graph.ts` o `process-mailbox.ts`. El modelo no la verá.
- **Algo que la analista pide en el chat** (una consulta o una forma de encender el motor) → `api/src/tools/recepcion.ts`. Debe ser de solo lectura o delegar en el motor: nunca contiene reglas de negocio. Mantén el conjunto pequeño: cada herramienta extra es una opción más para equivocarse.

Pasos (los mismos en los dos archivos):

1. Lógica en un caso de uso nuevo `api/src/application/use-cases/<accion>.ts` que devuelva `Promise<Resultado<T>>`.
2. En el archivo de herramientas elegido:

   ```ts
   export const mi_accion = definirHerramienta({
     nombre: nombre("mi_accion"),
     description: "Una frase precisa de cuándo usarla.",
     args: { mensaje_id: MensajeIdSchema },
     ejecutar: (args, _ctx, rutas) => miAccion(rutas, args.mensaje_id),
     resumir: (data) => `resumen corto para el log y el chat`,
   });
   ```

3. Regístrala en el objeto `herramientas` con `[nombre("mi_accion")]: mi_accion`.
4. Reexpórtala en `modulo/tools/contratos.ts` o `modulo/tools/recepcion.ts`.
5. Menciónala en `api/src/knowledge/registro-contratos.md` (sección «Dos capas») y, si es de la recepcionista, en la tabla de `agent/prompt.md`; luego `bun run sync:module`.
6. Prueba en `api/tests/integration/tools.test.ts` (motor) o `receptionist.test.ts` (recepcionista) y, si el guion offline debe usarla, en `api/src/llm/offline/script.ts`.

### Nuevo proveedor LLM

Ver [Proveedores LLM → Agregar un proveedor](LLM-Providers.md#agregar-un-proveedor).

### Nuevo endpoint

1. Lógica en un caso de uso o en `workflows/`; devuelve `ResultadoHitl<T>` si tiene códigos de negocio.
2. Tipos de petición y respuesta en `api/src/http/types.ts` (los usa el front).
3. Ruta en `api/src/http/app.ts` (chat y lectura general) o `api/src/http/hitl.ts` (buzón y bandeja):
   - cuerpo con `leerCuerpo(c, Esquema)`,
   - respuesta con `responder(c, resultado)` o `c.json<Tipo>(...)`,
   - envuelve en `acceso.compartido(...)` si toca `out/`.
4. Si agregas un código de fallo, mapéalo en `ESTADO_HTTP` (`api/src/http/helpers.ts`).
5. Prueba con `crearApp(...).request(...)` en `api/tests/integration/api.test.ts` o `approval-tray.test.ts`.
6. Documenta en el README (tabla API) y en [API HTTP](API.md).

### Nueva vista del front

1. `web/src/views/<Nombre>View.tsx`, export con el mismo nombre.
2. Llamadas solo vía `web/src/lib/api.ts` (agrega ahí la función); tipos desde `lib/api.ts`.
3. Componentes reutilizables en `web/src/components/`; formato en `lib/format.ts`.
4. Registra la pestaña en `App.tsx` (`Tab`, `SECCIONES`, `ICONOS`, `ETIQUETAS_TAB`).
5. `bun run typecheck && bun run build`.

### Cambiar el comportamiento del agente

1. Edita `agent/prompt.md` (comportamiento) o `api/src/knowledge/registro-contratos.md` (conocimiento). No hace falta reiniciar: se leen en cada turno.
2. `bun run sync:module`.
3. Si el cambio es un invariante (p. ej. confirmación), impleméntalo también en código: el prompt solo no basta.

## Checklist antes de entregar

```bash
bun run typecheck && bun test && bun run sync:module --check && bun run demo
```

- [ ] Typecheck y pruebas en verde.
- [ ] `modulo/` sincronizado.
- [ ] `bun run demo` da el resultado esperado de los 6 mensajes.
- [ ] Si tocaste el front: `bun run build`.
- [ ] Si tocaste la imagen o rutas copiadas por el `Dockerfile`: `docker build .`.
- [ ] README, `SOLUCION.md` y la página de la wiki afectada al día.
- [ ] Ningún secreto en el repositorio, el front ni los logs.
