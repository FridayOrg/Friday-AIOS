"use client";

import { useCallback, useRef, useState } from "react";
import { Menu, User } from "lucide-react";
import Sidebar from "./Sidebar";
import AskFriday from "./AskFriday";
import { HighlightProvider } from "@/lib/highlight-context";

// Ask Friday panel: draggable between a minimum of 24% of the viewport width and a
// max of 80% (a "maximize" ceiling that still leaves the main content visible).
const MIN_PANEL_VW = 24;
const MAX_PANEL_VW = 80;
const DEFAULT_PANEL_VW = 26;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true); // collapsed by default
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_VW);
  const draggingRef = useRef(false);

  // Mobile-only (< lg) state: the sidebar as a slide-in drawer, and Ask Friday as a
  // full-screen overlay behind a floating button — desktop keeps the always-visible
  // sidebar/panel above untouched.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current) return;
    const vw = ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
    setPanelWidth(Math.min(MAX_PANEL_VW, Math.max(MIN_PANEL_VW, vw)));
  }, []);

  const stopDragging = useCallback(() => {
    draggingRef.current = false;
    window.removeEventListener("pointermove", onPointerMove);
    // Self-reference is intentional: removeEventListener needs the exact function it
    // was added with, and stopDragging's identity is stable (only depends on the
    // already-stable onPointerMove) so this closes over its own finished value.
    // eslint-disable-next-line react-hooks/immutability
    window.removeEventListener("pointerup", stopDragging);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onPointerMove]);

  const startDragging = useCallback(() => {
    draggingRef.current = true;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [onPointerMove, stopDragging]);

  return (
    <HighlightProvider>
      <div className="flex h-screen w-full overflow-hidden">
        {/* Desktop sidebar — unchanged, just wrapped so it never renders below lg */}
        <div className="hidden lg:block h-full">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((c) => !c)}
          />
        </div>

        {/* Mobile sidebar drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative h-full shadow-xl">
              <Sidebar
                collapsed={false}
                onToggle={() => setMobileMenuOpen(false)}
                mobile
                onClose={() => setMobileMenuOpen(false)}
              />
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Mobile top bar */}
          <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white shrink-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-50"
            >
              <Menu size={22} />
            </button>
            <div className="text-lg font-bold text-slate-900">
              friday<span className="text-blue-600">.</span>
            </div>
            <div className="h-8 w-8 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center">
              <User size={16} />
            </div>
          </div>

          <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
        </div>

        {/* Drag handle — hover/drag anywhere on this thin strip to resize the panel */}
        <div
          onPointerDown={startDragging}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Ask Friday panel"
          className="hidden lg:block w-1.5 shrink-0 h-full cursor-col-resize bg-transparent hover:bg-blue-200 active:bg-blue-300 transition-colors"
        />

        <div
          className="hidden lg:block shrink-0 h-full"
          style={{ width: `${panelWidth}vw` }}
        >
          <AskFriday />
        </div>

        {/* Mobile floating "Ask Friday" button */}
        {!mobileChatOpen && (
          <button
            onClick={() => setMobileChatOpen(true)}
            aria-label="Talk to Friday"
            title="Talk to Friday"
            className="lg:hidden fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-blue-600 shadow-lg flex items-center justify-center hover:bg-blue-700 transition-colors overflow-hidden"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/friday-mark.png" alt="Friday" className="h-full w-full object-cover" />
          </button>
        )}

        {/* Mobile Ask Friday overlay */}
        {mobileChatOpen && (
          <div className="lg:hidden fixed inset-0 z-50 bg-black/40">
            <div className="absolute inset-x-0 bottom-0 h-[88vh] bg-slate-50 rounded-t-2xl overflow-hidden shadow-xl">
              <AskFriday onClose={() => setMobileChatOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </HighlightProvider>
  );
}
