# Reto 2 — Agente de contratos

Implementación completa en **`langgraph_app/`** (TypeScript + Bun + LangGraph + Gemini).

## Objetivo cubierto

Agente conversacional como **punto único de recepción** que:

1. Clasifica correos del buzón  
2. Extrae datos de contratos con **confianza por campo** (Gemini → fallback heurístico)  
3. Resuelve autoría y valida reglas de negocio  
4. Registra/actualiza el maestro simulado de SharePoint (CSV)  
5. Archiva documentos y deja auditoría  
6. Genera reportes de alertas de vencimiento  

## Arranque

```bash
cd langgraph_app
bun install
# Edita .env con GOOGLE_API_KEY de https://aistudio.google.com/apikey (prefijo AIza...)

bun start          # chat conversacional
bun run process    # procesa buzón + reporte
bun run studio     # despliegue local LangGraph Studio (Chat Mode)
```

Ver detalle en [`langgraph_app/README.md`](langgraph_app/README.md).

> La carpeta `src/` de la raíz es el ejemplo original offline (Node). El entregable del reto es `langgraph_app/`.
