// The tab's one toast: what a change did — a status change, a rename, a move to another project —
// with Undo where it can be taken back, or why it was not done. A newer toast replaces the one
// showing, and its Undo with it.

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a toast shows. Shorter than the backend's 5 s status window, so an Undo of a status
 *  change always lands inside it (`useStatusMoves.ts`). */
export const TOAST_MS = 4000;

export interface Toast {
  /** Tells one toast from the next, so a new one restarts its time. */
  key: number;
  text: string;
  /** Takes the change back; `null` for a toast that only says something. */
  undo: (() => void) | null;
  /** Hover text: the backend's own words for a refused change. */
  title?: string;
}

/** Show a toast: `undo` for one that offers Undo, `title` for its hover text. */
export type ShowToast = (text: string, undo: (() => void) | null, title?: string) => void;

export interface Toasts {
  toast: Toast | null;
  show: ShowToast;
  close: () => void;
}

export function useToast(): Toasts {
  const [toast, setToast] = useState<Toast | null>(null);
  const keys = useRef(0);

  const show = useCallback<ShowToast>((text, undo, title) => {
    keys.current += 1;
    setToast(title === undefined ? { key: keys.current, text, undo } : { key: keys.current, text, undo, title });
  }, []);
  const close = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast((t) => (t?.key === toast.key ? null : t)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return { toast, show, close };
}
