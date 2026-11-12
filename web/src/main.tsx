import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatApp } from "./chat/ChatApp";
import "./chat/chat.css";

const raiz = document.getElementById("root");
if (!raiz) throw new Error("falta el elemento #root en index.html");

createRoot(raiz).render(
  <StrictMode>
    <ChatApp />
  </StrictMode>,
);
