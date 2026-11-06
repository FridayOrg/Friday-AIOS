"use client";

import { useState } from "react";
import { FileText, ArrowLeft, Plus, Download, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

// Proposal Generator: three steps, inputs -> section check -> result. The backend does
// all the work (section picking, writing, building the Word file); this page only
// collects inputs and shows what comes back. No proposal content is hardcoded here.

interface Section {
  key: string;
  title: string;
  custom: boolean;
  selected: boolean;
}

interface GenerateResult {
  filename: string;
  needs_input: string[];
  docx_base64: string;
}

type Step = "input" | "sections" | "result";

const STEPS: { id: Step; label: string }[] = [
  { id: "input", label: "Details" },
  { id: "sections", label: "Sections" },
  { id: "result", label: "Download" },
];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data as T;
}

function downloadDocx(result: GenerateResult) {
  const bytes = Uint8Array.from(atob(result.docx_base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ProposalsPage() {
  const [step, setStep] = useState<Step>("input");
  const [clientName, setClientName] = useState("");
  const [clientContact, setClientContact] = useState("");
  const [meetingNotes, setMeetingNotes] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [customTitle, setCustomTitle] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputs = {
    client_name: clientName.trim(),
    client_contact: clientContact.trim(),
    meeting_notes: meetingNotes.trim(),
    additional_info: additionalInfo.trim(),
  };
  const inputsReady = Boolean(inputs.client_name && inputs.client_contact && inputs.meeting_notes);
  const selectedCount = sections.filter((s) => s.selected).length;

  async function analyse() {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ sections: Omit<Section, "selected">[] }>("/api/proposals/analyse", inputs);
      setSections(data.sections.map((s) => ({ ...s, selected: true })));
      setStep("sections");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<GenerateResult>("/api/proposals/generate", {
        ...inputs,
        sections: sections.filter((s) => s.selected).map(({ key, title, custom }) => ({ key, title, custom })),
      });
      setResult(data);
      setStep("result");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addCustomSection() {
    const title = customTitle.trim();
    if (!title) return;
    setSections((prev) => [...prev, { key: `custom_${prev.length + 1}`, title, custom: true, selected: true }]);
    setCustomTitle("");
  }

  function startOver() {
    setStep("input");
    setClientName("");
    setClientContact("");
    setMeetingNotes("");
    setAdditionalInfo("");
    setSections([]);
    setResult(null);
    setError(null);
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="p-8 w-[70%] min-w-[320px] mx-auto min-h-full bg-[#F5F6F8]">
      <div className="flex items-center gap-2 mb-2">
        <FileText size={22} className="text-sky-600" />
        <h1 className="text-2xl font-bold text-slate-900">Proposal Generator</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Turn meeting notes into a ready-to-review Word proposal.</p>

      {/* Step indicator */}
      <ol className="flex items-center gap-2 mb-6">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <span
              className={`h-6 w-6 rounded-full text-xs font-semibold flex items-center justify-center ${
                i <= stepIndex ? "bg-[#2563EB] text-white" : "bg-gray-200 text-slate-500"
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-sm ${i === stepIndex ? "font-semibold text-slate-900" : "text-slate-500"}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="w-8 h-px bg-gray-300 mx-1" />}
          </li>
        ))}
      </ol>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 sm:p-8">
        {error && (
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: inputs */}
        {step === "input" && (
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Client name</span>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Acme Ltd"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Client contact person</span>
              <input
                value={clientContact}
                onChange={(e) => setClientContact(e.target.value)}
                placeholder="e.g. Jane Smith, Head of IT"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Meeting notes</span>
              <textarea
                value={meetingNotes}
                onChange={(e) => setMeetingNotes(e.target.value)}
                placeholder="Paste the meeting summary here"
                rows={12}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100 resize-y"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">
                Additional information <span className="font-normal text-slate-400">(optional)</span>
              </span>
              <textarea
                value={additionalInfo}
                onChange={(e) => setAdditionalInfo(e.target.value)}
                placeholder="Anything else worth including that isn't in the meeting notes, e.g. a price already agreed, a detail from a separate call"
                rows={4}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100 resize-y"
              />
            </label>
            <div className="flex justify-end">
              <button
                onClick={analyse}
                disabled={!inputsReady || busy}
                className="flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                Analyse
              </button>
            </div>
          </div>
        )}

        {/* Step 2: section check */}
        {step === "sections" && (
          <div className="flex flex-col gap-6">
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm">
              <div className="grid grid-cols-[140px_1fr] gap-y-1">
                <span className="text-slate-500">Client</span>
                <span className="font-medium text-slate-800">{inputs.client_name}</span>
                <span className="text-slate-500">Contact person</span>
                <span className="font-medium text-slate-800">{inputs.client_contact}</span>
                <span className="text-slate-500">Meeting notes</span>
                <span className="text-slate-700 line-clamp-3 whitespace-pre-line">{inputs.meeting_notes}</span>
                {inputs.additional_info && (
                  <>
                    <span className="text-slate-500">Additional info</span>
                    <span className="text-slate-700 line-clamp-3 whitespace-pre-line">{inputs.additional_info}</span>
                  </>
                )}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-slate-800 mb-1">Suggested sections</h2>
              <p className="text-xs text-slate-500 mb-3">Untick anything you don&apos;t want in the proposal.</p>
              <ul className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200">
                {sections.map((s) => (
                  <li key={s.key}>
                    <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={s.selected}
                        onChange={() =>
                          setSections((prev) => prev.map((x) => (x.key === s.key ? { ...x, selected: !x.selected } : x)))
                        }
                        className="h-4 w-4 accent-[#2563EB]"
                      />
                      <span className="text-sm text-slate-800">{s.title}</span>
                      {s.custom && (
                        <span className="ml-auto text-[11px] font-medium text-sky-700 bg-sky-50 rounded px-1.5 py-0.5">
                          Custom
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex gap-2">
                <input
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustomSection()}
                  placeholder="Add a custom section, e.g. Training plan"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100"
                />
                <button
                  onClick={addCustomSection}
                  disabled={!customTitle.trim()}
                  className="flex items-center gap-1.5 rounded-lg border border-[#2563EB] px-3 py-2 text-sm font-medium text-[#2563EB] hover:bg-blue-50 disabled:border-gray-300 disabled:text-gray-400 disabled:hover:bg-transparent"
                >
                  <Plus size={15} />
                  Add
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep("input")}
                disabled={busy}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                <ArrowLeft size={15} />
                Back
              </button>
              <button
                onClick={generate}
                disabled={selectedCount === 0 || busy}
                className="flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        )}

        {/* Step 3: result */}
        {step === "result" && result && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 size={20} />
              <span className="font-semibold">Proposal ready</span>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-slate-800 mb-2">Needs your input</h2>
              {result.needs_input.length ? (
                <ul className="flex flex-col gap-1.5">
                  {result.needs_input.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-sm text-slate-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Nothing missing. Review the document before sending.</p>
              )}
              <p className="mt-2 text-xs text-slate-500">Items to fill are shown in red in the Word file.</p>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={startOver}
                className="rounded-lg border border-[#2563EB] bg-white px-5 py-2.5 text-sm font-semibold text-[#2563EB] hover:bg-blue-50 transition-colors"
              >
                Start a new proposal
              </button>
              <button
                onClick={() => downloadDocx(result)}
                className="flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                <Download size={16} />
                Download Word
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
