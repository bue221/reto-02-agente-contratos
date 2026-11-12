# Supuestos y decisiones (borrador para `SOLUCION.md`)

Decisiones tomadas al interpretar el PRD en la fase 1 (herramientas + demo). Cada una indica dónde vive en el código.

## Extracción

1. **Cliente = la parte rotulada `EL CONTRATANTE`** distinta de Periferia (NIT 900123456). La razón social se toma del preámbulo en mayúsculas y se busca su forma con mayúsculas/minúsculas en el bloque de firmas (`src/extraccion/partes.ts`).
2. **NIT sin DV**: se toma el primer segmento antes del guion y se quitan los puntos (`890.900.111-4` → `890900111`). Los RUC/RTN se dejan como vienen.
3. **País**: por tipo de identificador (NIT → CO, RTN → HN, RUC de 13 dígitos → EC, de 11 → PE, otro → PA) cruzado con la ciudad o país del domicilio del contratante. Si coinciden, 0.95; si solo hay uno, 0.85; si se contradicen, 0.5.
4. **Fechas en prosa**: se usa la cifra entre paréntesis (`primero (1) de agosto de 2026`). Una fecha imposible (31 de febrero) o un mes desconocido es un error legible, no un `null`.
5. **Plazo de N meses**: el fin es inclusivo (`inicio + N meses − 1 día`). Si el documento trae rango y meses y no cuadran, `fecha_fin` baja a 0.6.
6. **msg-006 (firma solo con mes)**: inicio = día 1 del mes de firma y fin = último día del mes N (cota superior, `2027-08-31`), ambos con confianza 0.5 para forzar confirmación. Coincide con la confirmación del PRD ("fecha fin 2027-08-31").
7. **Valor por demanda**: `valor = 0`, `valor_indeterminado = true`, confianza 0.5. La moneda se toma de otra cláusula que cite un código (la de garantías: `COP $100.000.000`) con 0.8.
8. **Garantía condicional (msg-006)**: la póliza se exige solo por orden de servicio > COP 100 M, no por el contrato marco. Se registra `requiere_poliza = false` (confianza 0.8) y una nota; cada orden se evaluará cuando llegue. Alternativa descartada: `true` + `pendiente`, que generaría una alerta de póliza que hoy nadie puede constituir.
9. **Objeto**: el texto literal de la cláusula `OBJETO`, truncado en palabra a 200 caracteres (confianza 0.85 si se trunca). No se resume para no introducir texto que no está en el documento.
10. **Moneda desconocida**: un código de 3 letras distinto de COP/USD/PEN/PAB/HNL delante de una cifra en la cláusula de valor es un error (`EUR`), salvo siglas como IVA/NIT/RUC.

## Reglas

11. **La confianza nunca viene del llamador**: `validar` y `registrar` vuelven a extraer el documento en el servidor. Un campo cuyo valor coincide con la extracción hereda su confianza; uno cambiado por el modelo/usuario queda en 0 y solo pasa con `confirmado = true` (`src/reglas/campos.ts`).
12. **Otrosí**: solo trae los campos que modifica; el resto se hereda de la fila del maestro con confianza 1 y no entra en revisión. Un otrosí de un contrato que no está en el maestro se rechaza con motivo.
13. **Otrosí que amplía el plazo de un contrato con póliza** → `estado_poliza = pendiente`, porque la póliza vigente no cubre el nuevo plazo (el propio otrosí de msg-003 dice que las garantías "deberán ampliarse"). Por eso CT-2026-011 aparece en la alerta de pólizas.
14. **Duplicado (RN1)** se evalúa antes que la actualización: mismo id y mismos valor y fechas no escribe nada aunque difieran otros campos. Un otrosí ya aplicado (sin diferencias) también es duplicado.
15. **Conflictos con el maestro** que entran en `requiere_revision`: NIT distinto para el mismo id; mismo NIT + objeto ≥ 0.9 con otro número de contrato; NIT conocido con otra razón social; `fecha_fin` anterior a `fecha_inicio`.
16. **Rechazado y duplicado son terminales**: `validar` (y `registrar`) los marcan en `out/procesados.json`, así salen del buzón sin escribir en el maestro.
17. **Remitente desconocido**: se reporta en `avisos` y la columna `comercial` guarda su correo para no perder la trazabilidad.

## Salidas

18. **Archivo**: `Contratos/<año_inicio>/<slug-cliente-sin-sufijo-societario>/<id>.<ext>`. Los adjuntos de los fixtures son `.txt`, así que se archivan como `.txt`. Un otrosí se archiva como `<id>-otrosi-<n>.<ext>` junto al contrato y la fila conserva la ruta del contrato original; el historial guarda la ruta del otrosí.
19. **Una actualización conserva** `fecha_registro`, `fuente` y `comercial` originales; el cambio queda en `historial.jsonl`.
20. **`fecha_registro`** se inyecta por `ctx.hoy` (la demo usa 2026-09-03) para que la salida sea determinista; sin `ctx.hoy` se usa la fecha del sistema.
21. **Alertas**: "vencen en ≤ 60 días" incluye solo contratos con 0–60 días restantes; los ya vencidos no aparecen en esa sección.

## Fuera de la fase 1

- `contratos_leer_pdf` (P1 opcional) no está implementada: los fixtures traen texto.
- El servidor HTTP, el ciclo del agente, el adaptador LLM, el front y `modulo/` son de la fase 2.
