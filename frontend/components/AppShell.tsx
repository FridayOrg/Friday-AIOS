"use client";

import { useCallback, useRef, useState } from "react";
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
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
        />

        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>

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
      </div>
    </HighlightProvider>
  );
}
