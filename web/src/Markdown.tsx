import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

// react-markdown no interpreta HTML crudo por defecto: el texto del LLM no puede inyectar markup.
const COMPONENTES: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  table: ({ node: _node, ...props }) => (
    <div className="md-table">
      <table {...props} />
    </div>
  ),
};

// remark-breaks: el LLM suele usar saltos de línea simples como cortes visibles.
const PLUGINS = [remarkGfm, remarkBreaks];

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTES}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
