---
# Generado por scripts/sync-modulo.ts: no editar a mano. Fuente: src/knowledge/registro-contratos.md
name: registro-contratos
description: Conocimiento del proceso de registro de contratos vigentes (reglas RN1–RN7, esquema del maestro, umbral de confianza, alertas y regla de gobierno). Úsalo al procesar el buzón de contratos.
---

# Conocimiento del proceso: registro de contratos vigentes

## Contexto

El maestro de contratos estuvo congelado desde el **2026-05-30**: solo llegaban a administración los contratos con póliza. El buzón único `contratos@periferia-ficticia.com` recibe ahora **todo** contrato, con o sin póliza. El maestro vive en `out/sharepoint/maestro-contratos.csv` (copia del fixture, que es de solo lectura) y los documentos se archivan en `out/sharepoint/Contratos/<año_inicio>/<cliente-slug>/<id_contrato>.<ext>`.

## Herramientas

| Herramienta | Para qué |
|---|---|
| `contratos_leer_buzon` | Mensajes no procesados con remitente, asunto, adjuntos y `tiene_contrato`. |
| `contratos_extraer` | Datos del contrato con `confianza` por campo en [0, 1]; ausentes = `null` con confianza 0. |
| `contratos_validar` | Clasificación (`nuevo`, `actualizacion`, `duplicado`, `rechazado`), `requiere_revision[]`, diferencias y avisos. |
| `contratos_registrar` | Escribe/actualiza la fila, archiva el documento y deja historial. Con campos en revisión exige `confirmado: true`. |
| `contratos_alertas` | Genera `out/alertas.md` para la fecha `hoy` indicada. |

## Reglas de negocio

| # | Regla |
|---|---|
| RN1 | **Duplicado**: mismo `id_contrato` y mismos `valor`, `fecha_inicio` y `fecha_fin`. No se escribe nada; se reporta. |
| RN2 | **Actualización**: mismo `id_contrato` (o mismo `nit_cliente` + `objeto` con similitud ≥ 0.9) y algún campo distinto, o el documento es un otrosí. Se actualiza la fila y el cambio queda en `historial.jsonl`. |
| RN3 | **Nuevo**: no hay coincidencia en el maestro. Se inserta. |
| RN4 | **Rechazado**: sin adjunto de contrato, o sin partes ni objeto identificables. Se reporta con motivo. |
| RN5 | Un campo con **confianza < 0.8** entra en `requiere_revision`. `contratos_registrar` sin `confirmado: true` lo rechaza. |
| RN6 | El fixture del maestro es de solo lectura; la primera ejecución lo copia a `out/sharepoint/`. |
| RN7 | Toda llamada a herramienta deja una línea en `out/log.jsonl` con `{ ts, herramienta, mensaje_id, ok, resumen }`. |

## Esquema del maestro (una fila por contrato)

`id_contrato`, `cliente`, `nit_cliente` (sin puntos ni dígito de verificación), `pais` (CO, EC, PE, PA, HN), `objeto` (máx. 200 caracteres), `valor` (número sin separadores; 0 si es por demanda), `moneda` (COP, USD, PEN, PAB, HNL), `fecha_inicio`, `fecha_fin` (YYYY-MM-DD), `requiere_poliza`, `tipo_poliza` (lista separada por `;`), `estado_poliza` (vigente, pendiente, vencida, no_aplica; un registro nuevo con póliza queda `pendiente`), `comercial`, `ruta_sharepoint`, `fecha_registro`, `fuente` (buzon, manual, migracion).

## Confianza y confirmación

- El umbral de revisión es **0.8**. La confianza la calcula el servidor reextrayendo el documento: un valor que el modelo cambie respecto a la extracción queda con confianza 0 y solo pasa con confirmación.
- Pedir confirmación significa: mostrar cada campo dudoso con su valor, confianza y evidencia, y **terminar el turno con una pregunta**. Se registra solo si el siguiente mensaje de la analista confirma o corrige los valores.
- Un remitente que no está en `comerciales.json` se reporta como aviso pero no bloquea: la columna `comercial` guarda su correo hasta que se asigne un responsable.

## Alertas

`contratos_alertas` produce tres secciones: contratos que **vencen en 0–60 días** desde `hoy`, contratos con `requiere_poliza = true` y `estado_poliza` distinto de `vigente`, y contratos **registrados desde el 2026-05-30** (gap cubierto).

## Supuestos que aplican las herramientas

- El cliente es la parte rotulada «EL CONTRATANTE» distinta de Periferia (NIT 900123456).
- Las fechas en prosa se leen de la cifra entre paréntesis; un plazo de N meses termina el día anterior al mismo día N meses después.
- Un contrato firmado solo con mes y año toma el día 1 como inicio y el último día del mes N como fin, ambos con confianza 0.5: siempre requiere confirmación.
- Valor por demanda: `valor = 0`, `valor_indeterminado = true`, confianza 0.5.
- Un otrosí trae solo los campos que modifica; el resto se hereda del maestro. Si amplía el plazo de un contrato con póliza, la póliza vuelve a `pendiente`.
- Un otrosí de un contrato que no está en el maestro se rechaza: primero debe registrarse el original.

## Regla de gobierno (resumen)

- **Canal único**: `contratos@periferia-ficticia.com`, administrado por la analista administrativa, que es la **dueña del maestro**.
- **El comercial envía** el PDF firmado, cada otrosí y cada acta de terminación dentro de los **3 días hábiles** siguientes a la firma, con asunto `CONTRATO | <cliente> | <número> | <tipo: nuevo/otrosí/terminación>`.
- **Acuse automático** al comercial en menos de 1 hora hábil con la clasificación y lo que falte.
- **Excepciones**: un contrato sin firma o sin valor no se registra como vigente; se devuelve al comercial y, si no se corrige en 5 días hábiles, se escala a su gerente comercial.
- **Indicador mensual**: % de contratos facturados en el mes que existen en el maestro (meta ≥ 95 %).
