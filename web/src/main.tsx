import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";
import "./styles/chat.css";

const raiz = document.getElementById("root");
if (!raiz) throw new Error("falta el elemento #root en index.html");

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
