import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Renders children into the top bar's action slot (see routes/__root.tsx). */
export function HeaderActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("header-actions")), []);
  return slot ? createPortal(children, slot) : null;
}
