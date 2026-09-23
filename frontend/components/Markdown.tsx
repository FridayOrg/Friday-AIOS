import ReactMarkdown from "react-markdown";

// Friday's responses come back as Markdown (**bold**, bullet lists, ### headers).
// This renders it properly instead of showing literal asterisks/hashes, with plain
// Tailwind utility classes on each element (no @tailwindcss/typography dependency).
export default function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold text-white">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => (
          <ul className="list-disc pl-5 mb-2 last:mb-0 flex flex-col gap-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 mb-2 last:mb-0 flex flex-col gap-1">{children}</ol>
        ),
        li: ({ children }) => <li>{children}</li>,
        h1: ({ children }) => <h3 className="font-semibold text-base mt-3 mb-1 first:mt-0">{children}</h3>,
        h2: ({ children }) => <h3 className="font-semibold text-base mt-3 mb-1 first:mt-0">{children}</h3>,
        h3: ({ children }) => <h3 className="font-semibold text-sm mt-3 mb-1 first:mt-0">{children}</h3>,
        code: ({ children }) => (
          <code className="bg-white/10 rounded px-1 py-0.5 text-[13px]">{children}</code>
        ),
        hr: () => <hr className="my-3 border-white/10" />,
        a: ({ children, href }) => (
          <a href={href} className="text-sky-400 underline" target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
