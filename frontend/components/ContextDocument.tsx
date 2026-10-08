import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Light-theme renderer for the Company page's context documents (the dark
// chat-panel renderer lives in Markdown.tsx). Tables, lists, bold and
// headings are styled as a readable document instead of raw markdown text.
export default function ContextDocument({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-2xl font-bold text-slate-900 mb-6 pb-4 border-b border-gray-200">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-semibold text-slate-900 mt-8 mb-3 pl-3 border-l-4 border-sky-500">{children}</h2>
        ),
        h3: ({ children }) => <h3 className="text-base font-semibold text-slate-800 mt-6 mb-2">{children}</h3>,
        h4: ({ children }) => <h4 className="text-sm font-semibold text-slate-800 mt-4 mb-2">{children}</h4>,
        p: ({ children }) => <p className="text-sm text-slate-600 leading-relaxed mb-3">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => (
          <ul className="list-disc marker:text-sky-500 pl-5 mb-4 flex flex-col gap-1.5 text-sm text-slate-600 leading-relaxed">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal marker:text-sky-600 pl-5 mb-4 flex flex-col gap-1.5 text-sm text-slate-600 leading-relaxed">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="pl-1">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-gray-200 bg-gray-50 rounded-r-lg px-4 py-2 mb-4 text-slate-600">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-6 border-gray-200" />,
        code: ({ children }) => (
          <code className="bg-gray-100 text-slate-800 rounded px-1 py-0.5 text-[13px]">{children}</code>
        ),
        a: ({ children, href }) => (
          <a href={href} className="text-sky-600 hover:underline" target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto mb-5 rounded-xl border border-gray-200">
            <table className="w-full text-sm text-left border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-slate-50 text-slate-700">{children}</thead>,
        tr: ({ children }) => <tr className="border-b border-gray-100 last:border-b-0">{children}</tr>,
        th: ({ children }) => (
          <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
            {children}
          </th>
        ),
        td: ({ children }) => <td className="px-3 py-2.5 text-slate-600 align-top">{children}</td>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
