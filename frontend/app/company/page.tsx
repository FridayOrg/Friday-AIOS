"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";

interface ContextFile {
  slug: string;
  title: string;
  content: string;
}

export default function CompanyPage() {
  const [files, setFiles] = useState<ContextFile[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/context")
      .then((r) => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setFiles(data.files);
        setActiveSlug(data.files[0]?.slug ?? null);
      })
      .catch(() => setError("Couldn't load company context files. Try refreshing, or check the server logs."))
      .finally(() => setLoading(false));
  }, []);

  const active = files.find((f) => f.slug === activeSlug);

  return (
    <div className="p-8 max-w-5xl mx-auto min-h-full bg-[#F5F6F8]">
      <div className="flex items-center gap-2 mb-6">
        <Building2 size={22} className="text-sky-600" />
        <h1 className="text-2xl font-bold text-slate-900">Company</h1>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading context files…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <div className="flex gap-6">
          <nav className="w-48 shrink-0 flex flex-col gap-1">
            {files.map((f) => (
              <button
                key={f.slug}
                onClick={() => setActiveSlug(f.slug)}
                className={`text-left text-sm rounded-lg px-3 py-2 font-medium transition-colors ${
                  f.slug === activeSlug
                    ? "bg-sky-50 text-sky-700"
                    : "text-slate-600 hover:bg-gray-100"
                }`}
              >
                {f.title}
              </button>
            ))}
          </nav>

          <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 min-w-0">
            {active ? (
              <article className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-[inherit]">
                {active.content}
              </article>
            ) : (
              <p className="text-sm text-slate-500">No context files found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
