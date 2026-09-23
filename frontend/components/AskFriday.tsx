"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Square, Sparkles, Mic, Volume2, VolumeX, X } from "lucide-react";
import Markdown from "./Markdown";
import { useHighlight } from "@/lib/highlight-context";

interface ChatMessage {
  role: "user" | "friday";
  text: string;
  time: string;
  agent?: "daily" | "analyst";
}

const AGENT_LABEL: Record<string, string> = {
  daily: "Daily Update",
  analyst: "Analyst",
};

const SAMPLE_QUESTIONS = [
  "What are the important meetings I should attend today, and why?",
  "What tasks need my attention this week?",
  "Why should I prioritize the Northgate renewal decision?",
];

const VOICE_OUT_KEY = "friday_voice_out";

// Voice input: keep listening across natural pauses, and only finish + send once the
// speaker has been silent this long. Bump SILENCE_MS if it still cuts people off.
const SPEECH_LANG = "en-IN";
const SILENCE_MS = 1600;
const MAX_LISTEN_MS = 60_000; // hard cap so a stuck session can't listen forever

// Input box grows with the message (like Claude/ChatGPT) up to this height, then
// scrolls internally rather than either truncating or growing unbounded.
const MAX_INPUT_HEIGHT_PX = 160;

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Scheduling now happens immediately, server-side (see backend/app/main.py's
// _execute_schedule_proposal) — the agent's reply already IS the final
// confirmation text by the time it reaches the client, so this just checks
// for that fixed marker to trigger a dashboard refresh (Calendar card / Next
// Meetings tile), not to render any special UI of its own.
const SCHEDULED_MARKER = "Meeting scheduled:";

export default function AskFriday({ onClose }: { onClose?: () => void }) {
  const router = useRouter();
  const { highlightFromText } = useHighlight();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false); // waiting for the first chunk
  const [streaming, setStreaming] = useState(false); // chunks are actively arriving
  const [input, setInput] = useState("");

  // Voice
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOut, setVoiceOut] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeStreamRef = useRef<{ full: string; done: boolean } | null>(null);
  const rafRef = useRef<number | null>(null);
  // Speech-to-text. The Web Speech API ends a session on its own after a short pause,
  // so we keep our own state, restart it when the user is still talking, and decide
  // when to finish based on a silence timer:
  //  - listeningRef     : mirror of `listening` for use inside callbacks
  //  - committedRef      : finalized transcript carried across auto-restarts
  //  - segFinalRef       : final transcript of the current recognition segment
  //  - silenceTimerRef   : fires SILENCE_MS after the last speech → finish + send
  //  - maxTimerRef       : MAX_LISTEN_MS hard cap
  //  - finishingRef      : we've decided to finish (silence / tap / cap) → send on end
  //  - abortMicRef       : cancel with no send (new turn, denied permission, unmount)
  //  - restartCountRef   : guards against a restart loop if the mic keeps dropping
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const committedRef = useRef("");
  const segFinalRef = useRef("");
  const silenceTimerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const finishingRef = useRef(false);
  const abortMicRef = useRef(false);
  const restartCountRef = useRef(0);
  // Spoken-reply pipeline: the answer is spoken sentence-by-sentence as it streams,
  // so audio starts a sentence or two in rather than after the whole reply.
  //  - audioRef        : the clip playing right now (so a new turn / Stop cuts it off)
  //  - ttsQueueRef     : sentences waiting to be synthesized + played, in order
  //  - ttsRunningRef   : is the drain loop already going
  //  - ttsGenRef       : bumped on every reset; in-flight work checks it and bails
  //  - spokenIdxRef    : how far into the current reply text has been queued already
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsQueueRef = useRef<string[]>([]);
  const ttsRunningRef = useRef(false);
  const ttsGenRef = useRef(0);
  const spokenIdxRef = useRef(0);
  // Always points at the latest send() so the recognition callback never fires a
  // stale closure (old history / old voiceOut).
  const sendRef = useRef<(t?: string) => void>(() => {});
  // Mirror voiceOut so the mid-stream pumpSpeech() calls inside an in-flight send()
  // see the current setting, not the value captured when that send() started.
  const voiceOutRef = useRef(false);
  useEffect(() => {
    voiceOutRef.current = voiceOut;
  }, [voiceOut]);
  const busy = loading || streaming;

  // Grow the textarea to fit the message (capped, then it scrolls internally) — reset
  // to `auto` first so shrinking (e.g. after clearing the input) recomputes correctly
  // instead of only ever growing.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [input]);

  // Restore the voice-output preference (per browser). Must run in an effect —
  // localStorage isn't available during server render, so this is a deliberate
  // one-time post-mount sync, not state derivable at render time.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVoiceOut(localStorage.getItem(VOICE_OUT_KEY) === "1");
    } catch {
      /* private mode / storage blocked — default off */
    }
  }, []);

  function scrollToBottom() {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  // Appends to (or sets) the trailing Friday message, rather than replacing the
  // whole message list — this is what makes the text grow in place.
  function updateLastFriday(text: string) {
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (last?.role === "friday") {
        copy[copy.length - 1] = { ...last, text };
      }
      return copy;
    });
    scrollToBottom();
  }

  function setLastFridayAgent(agent: "daily" | "analyst") {
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (last?.role === "friday") {
        copy[copy.length - 1] = { ...last, agent };
      }
      return copy;
    });
  }

  // Reveals `state.full` on screen progressively rather than jumping to it the
  // instant a (often sentence-sized) network chunk arrives. This never delays the
  // response — it only paces how already-downloaded text gets painted, the same way
  // ChatGPT/Claude's own UI smooths bursty network chunks into a steady flow. Any
  // backlog drains within ~10 frames (~160ms), so it never meaningfully lags behind
  // real arrival, and once state.done is set it simply finishes revealing what's left.
  function startReveal(state: { full: string; done: boolean }) {
    let revealed = 0;
    const tick = () => {
      if (activeStreamRef.current !== state) return; // superseded by a newer message
      if (revealed < state.full.length) {
        const remaining = state.full.length - revealed;
        const step = Math.max(1, Math.ceil(remaining / 10));
        revealed = Math.min(state.full.length, revealed + step);
        updateLastFriday(state.full.slice(0, revealed));
      }
      if (revealed < state.full.length || !state.done) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    tick();
  }

  // ---- Voice output (TTS) — sentence-streamed ----------------------------

  // Wipe the speech pipeline: stop the clip playing now, drop the queue, and
  // invalidate any fetch/decode already in flight.
  function resetSpeech() {
    ttsGenRef.current += 1;
    ttsQueueRef.current = [];
    ttsRunningRef.current = false;
    spokenIdxRef.current = 0;
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
    }
    audioRef.current = null;
    setSpeaking(false);
  }

  function playClip(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      const finish = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
    });
  }

  // Drains ttsQueueRef: synthesize the next sentence while the current one plays,
  // then play it, in order. Safe to call repeatedly — it no-ops if already running.
  async function drainSpeech() {
    if (ttsRunningRef.current) return;
    ttsRunningRef.current = true;
    const gen = ttsGenRef.current;
    setSpeaking(true);

    // one-clip look-ahead so the next fetch overlaps the current playback
    let prefetch: Promise<Response> | null = null;
    const fetchClip = (text: string) =>
      fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

    try {
      while (ttsQueueRef.current.length && gen === ttsGenRef.current) {
        const text = ttsQueueRef.current.shift()!;
        const res = await (prefetch ?? fetchClip(text));
        prefetch = null;

        if (gen !== ttsGenRef.current) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setVoiceNote(
            String(data.error ?? "").includes("ELEVENLABS") || res.status === 503
              ? "Add an ElevenLabs API key to .env to hear replies."
              : "Voice output is unavailable right now."
          );
          ttsQueueRef.current = [];
          return;
        }

        const blobP = res.blob();
        if (ttsQueueRef.current.length) prefetch = fetchClip(ttsQueueRef.current[0]);
        const blob = await blobP;
        if (gen !== ttsGenRef.current) return;

        setVoiceNote(null);
        await playClip(blob);
      }
    } finally {
      ttsRunningRef.current = false;
      if (gen === ttsGenRef.current && !ttsQueueRef.current.length) setSpeaking(false);
      else if (ttsQueueRef.current.length) drainSpeech(); // items arrived during finally
    }
  }

  // Queue any newly-complete sentence(s) from the reply so far. `flush` (stream end)
  // also queues a trailing fragment that has no terminator.
  function pumpSpeech(fullText: string, flush: boolean) {
    if (!voiceOutRef.current) return;
    const pending = fullText.slice(spokenIdxRef.current);
    let cut = 0;
    const re = /[.!?](?=\s|$)|\n/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(pending))) cut = m.index + 1;

    if (cut > 0 && (flush || cut >= 80)) {
      const chunk = pending.slice(0, cut).trim();
      spokenIdxRef.current += cut;
      if (chunk) {
        ttsQueueRef.current.push(chunk);
        drainSpeech();
      }
    }
    if (flush) {
      const rest = fullText.slice(spokenIdxRef.current).trim();
      spokenIdxRef.current = fullText.length;
      if (rest) {
        ttsQueueRef.current.push(rest);
        drainSpeech();
      }
    }
  }

  function toggleVoiceOut() {
    setVoiceOut((on) => {
      const next = !on;
      try {
        localStorage.setItem(VOICE_OUT_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (!next) resetSpeech();
      return next;
    });
  }

  // ---- Voice input (STT, browser Web Speech API) -------------------------

  function setMic(on: boolean) {
    listeningRef.current = on;
    setListening(on);
  }

  function clearMicTimers() {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    silenceTimerRef.current = null;
    maxTimerRef.current = null;
  }

  // Stop audio + mic if the panel ever unmounts.
  useEffect(() => {
    return () => {
      resetSpeech();
      abortMicRef.current = true;
      clearMicTimers();
      recognitionRef.current?.abort?.();
    };
  }, []);

  // (Re)start the "user has gone quiet" countdown. Called on every speech result, so
  // it only fires once talking actually stops for SILENCE_MS.
  function armSilenceTimer() {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = window.setTimeout(() => {
      finishingRef.current = true;
      try {
        recognitionRef.current?.stop();
      } catch {
        /* not running */
      }
    }, SILENCE_MS);
  }

  function currentTranscript() {
    return [committedRef.current, segFinalRef.current]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getRecognition(): SpeechRecognitionLike | null {
    if (recognitionRef.current) return recognitionRef.current;
    const Ctor =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    if (!Ctor) return null;

    const r = new Ctor();
    r.lang = SPEECH_LANG;
    r.interimResults = true;
    r.continuous = true; // keep going across pauses — our silence timer decides the end

    r.onresult = (e: SpeechRecognitionEventLike) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += chunk;
        else interim += chunk;
      }
      segFinalRef.current = final;
      setInput(
        [committedRef.current, final, interim].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
      );
      if (interim || final) armSilenceTimer(); // speech is happening → push the cutoff out
    };

    r.onerror = (e: SpeechRecognitionErrorLike) => {
      const err = e?.error;
      if (err === "aborted") return; // our own abort() — onend will clean up
      if (err === "not-allowed" || err === "service-not-allowed") {
        abortMicRef.current = true;
        setVoiceNote("Microphone access is blocked. Enable it in the browser and try again.");
        return;
      }
      // "no-speech" with nothing captured → quiet stop; anything else → send what we have
      if (err === "no-speech" && !currentTranscript()) abortMicRef.current = true;
      else finishingRef.current = true;
    };

    r.onend = () => {
      clearMicTimers();
      const text = currentTranscript();

      if (abortMicRef.current) {
        // cancelled (new turn / denied / unmount) — leave any text in the box, don't send
        abortMicRef.current = false;
        committedRef.current = "";
        segFinalRef.current = "";
        restartCountRef.current = 0;
        setMic(false);
        return;
      }

      if (finishingRef.current || !listeningRef.current) {
        // deliberate finish (silence timer, tap, or cap) → send
        finishingRef.current = false;
        committedRef.current = "";
        segFinalRef.current = "";
        restartCountRef.current = 0;
        setMic(false);
        if (text) sendRef.current(text);
        return;
      }

      // The API ended the session itself but the user is still holding the mic and
      // hasn't paused long enough to finish — carry the transcript and keep listening.
      if (restartCountRef.current++ < 8) {
        committedRef.current = text;
        segFinalRef.current = "";
        try {
          recognitionRef.current?.start();
          armSilenceTimer();
          return;
        } catch {
          /* fall through to finish */
        }
      }
      committedRef.current = "";
      segFinalRef.current = "";
      restartCountRef.current = 0;
      setMic(false);
      if (text) sendRef.current(text);
    };

    recognitionRef.current = r;
    return r;
  }

  function toggleMic() {
    if (listeningRef.current) {
      // tap again = "I'm done" → finish now and send
      finishingRef.current = true;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      try {
        recognitionRef.current?.stop();
      } catch {
        /* not running */
      }
      return;
    }
    const r = getRecognition();
    if (!r) {
      setVoiceNote("Voice input needs Chrome or Edge.");
      return;
    }
    setVoiceNote(null);
    committedRef.current = "";
    segFinalRef.current = "";
    finishingRef.current = false;
    abortMicRef.current = false;
    restartCountRef.current = 0;
    setInput("");
    resetSpeech(); // stop any reply still being spoken
    setMic(true);
    try {
      r.start();
    } catch {
      /* start() throws if already running — ignore */
    }
    maxTimerRef.current = window.setTimeout(() => {
      finishingRef.current = true;
      try {
        r.stop();
      } catch {
        /* not running */
      }
    }, MAX_LISTEN_MS);
  }

  function stop() {
    abortRef.current?.abort();
    const state = activeStreamRef.current;
    if (state) {
      state.done = true;
      updateLastFriday(state.full); // flush whatever had already arrived, don't lose it
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    resetSpeech();
  }

  async function send(overrideText?: string) {
    const question = (overrideText ?? input).trim();
    if (!question || busy) return;

    // If a mic session is still live (e.g. the user typed instead), cancel it silently
    // so its onend doesn't fire a second send. Not hit when send() is the auto-send
    // from onend itself — listeningRef is already false by then.
    if (listeningRef.current) {
      abortMicRef.current = true;
      clearMicTimers();
      try {
        recognitionRef.current?.abort?.();
      } catch {
        /* not running */
      }
      setMic(false);
    }

    resetSpeech(); // a new turn cuts off any reply still being spoken

    // Snapshot the conversation so far (before this turn) to send as history —
    // this is what gives follow-up questions like "which one is more important?"
    // access to what was actually being discussed. In-memory only: it lives in this
    // component's state, survives navigating between pages (the panel is mounted
    // once in the root layout), and resets on an actual page refresh.
    const history = messages
      .filter((m) => m.text.trim().length > 0)
      .map(({ role, text }) => ({ role, text }));

    setMessages((m) => [
      ...m,
      { role: "user", text: question, time: now() },
      { role: "friday", text: "", time: now() }, // placeholder, filled in as chunks arrive
    ]);
    setInput("");
    setLoading(true);
    scrollToBottom();

    const controller = new AbortController();
    abortRef.current = controller;
    const state = { full: "", done: false };
    activeStreamRef.current = state;

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        state.done = true;
        updateLastFriday(data.error ?? "No response.");
        return;
      }

      setLoading(false);
      setStreaming(true);
      startReveal(state);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? ""; // last item may be an incomplete event, keep it

        for (const raw of events) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.agent === "daily" || parsed.agent === "analyst") {
              setLastFridayAgent(parsed.agent);
            } else if (typeof parsed.delta === "string") {
              state.full += parsed.delta;
            } else if (typeof parsed.error === "string") {
              state.full += (state.full ? "\n\n" : "") + parsed.error;
            }
          } catch {
            // malformed SSE line; skip it rather than breaking the whole stream
          }
        }
        pumpSpeech(state.full, false); // queue any sentence completed by this batch
      }
      state.done = true; // reveal loop finishes catching up on its own, then stops
      pumpSpeech(state.full, true); // speak the final fragment
      highlightFromText(state.full); // match the dashboard against what Friday actually said, not the question
      if (state.full.includes(SCHEDULED_MARKER)) {
        // Re-run the dashboard's server-side data fetch so the Calendar card
        // and Next Meetings tile pick up the just-created event immediately.
        router.refresh();
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        state.done = true;
        updateLastFriday("Couldn't reach the Friday backend.");
      }
      // AbortError = user hit Stop; stop() already flushed the text.
    } finally {
      setLoading(false);
      setStreaming(false);
      abortRef.current = null;
    }
  }

  useEffect(() => {
    sendRef.current = send;
  });

  return (
    <aside className="w-full h-full flex flex-col bg-slate-50 border-l border-slate-200">
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-blue-700 font-semibold">
            <Sparkles size={18} />
            ASK FRIDAY
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleVoiceOut}
              aria-pressed={voiceOut}
              aria-label={voiceOut ? "Turn off spoken replies" : "Turn on spoken replies"}
              title={voiceOut ? "Spoken replies on" : "Spoken replies off"}
              className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                voiceOut
                  ? "bg-blue-100 text-blue-700"
                  : "text-slate-400 hover:text-slate-700 hover:bg-slate-200"
              } ${speaking ? "animate-pulse" : ""}`}
            >
              {voiceOut ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            {onClose && (
              <button
                onClick={onClose}
                aria-label="Close chat"
                className="lg:hidden h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="text-sm text-slate-400 mt-0.5">
          Your Business Advisor, always here.
          {voiceOut && <span className="text-[10px] text-slate-300"> · Voice by ElevenLabs</span>}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 flex flex-col gap-5">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3 mt-2">
            <p className="text-sm text-slate-500">
              Ask me anything about the business. I won&rsquo;t volunteer a briefing
              until you do. A few things you could start with:
            </p>
            {SAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="text-left text-sm rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700 hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm">
              {m.role === "user" ? (
                <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold bg-slate-200 text-slate-600">
                  Y
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src="/friday-mark.png"
                  alt="Friday"
                  className="h-7 w-7 rounded-full object-cover bg-blue-100"
                />
              )}
              <span className="font-medium text-slate-800">
                {m.role === "user" ? "You" : "Friday"}
              </span>
              {m.agent && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                  {AGENT_LABEL[m.agent]}
                </span>
              )}
              <span className="text-xs text-slate-400 ml-auto">{m.time}</span>
            </div>
            <div
              className={`ml-9 rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-white border border-slate-200 text-slate-700 whitespace-pre-wrap"
                  : "bg-blue-50 text-slate-800"
              }`}
            >
              {m.role === "friday" ? (
                m.text ? (
                  <Markdown text={m.text} />
                ) : i === messages.length - 1 && busy ? (
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce" />
                  </span>
                ) : null
              ) : (
                m.text
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-slate-200 bg-white">
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <button
            onClick={toggleMic}
            disabled={busy}
            aria-pressed={listening}
            aria-label={listening ? "Stop listening" : "Speak your message"}
            title={listening ? "Listening…" : "Speak"}
            className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
              listening
                ? "bg-red-500 text-white shadow-[0_0_0_4px_rgba(239,68,68,0.2)]"
                : "text-slate-400 hover:text-slate-700 hover:bg-slate-200"
            }`}
          >
            <Mic size={15} className={listening ? "animate-pulse" : ""} />
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 resize-none py-1"
            style={{ maxHeight: MAX_INPUT_HEIGHT_PX, overflowY: "auto" }}
            placeholder={listening ? "Listening… pause when you're done" : "Type or speak a message..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy}
          />
          {busy ? (
            <button
              onClick={stop}
              className="h-8 w-8 shrink-0 rounded-full bg-slate-700 text-white flex items-center justify-center"
              aria-label="Stop generating"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!input.trim()}
              className="h-8 w-8 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center disabled:opacity-40"
              aria-label="Send"
            >
              <Send size={15} />
            </button>
          )}
        </div>
        {voiceNote && (
          <p className="text-[11px] text-slate-400 mt-1.5 px-1">{voiceNote}</p>
        )}
      </div>
    </aside>
  );
}

// --- Minimal typings for the browser Web Speech API (not in the TS DOM lib) ----

interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: (e: SpeechRecognitionEventLike) => void;
  onerror: (e: SpeechRecognitionErrorLike) => void;
  onend: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
