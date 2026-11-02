import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./controls";
import c from "./controls.module.css";

type Tone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<((message: string, tone?: Tone) => void) | null>(null);

/** Short confirmations ("Saved"), announced politely to screen readers. Errors stay until dismissed. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback((message: string, tone: Tone = "success") => {
    const id = nextId.current++;
    setItems((list) => [...list.slice(-2), { id, tone, message }]);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={c.toasts} aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    if (item.tone === "error") return;
    const timer = window.setTimeout(onDismiss, 4200);
    return () => window.clearTimeout(timer);
  }, [item.tone, onDismiss]);

  return (
    <div className={c.toast} data-tone={item.tone} role={item.tone === "error" ? "alert" : "status"}>
      <p>{item.message}</p>
      <Button variant="ghost" size="sm" icon={<X size={14} aria-hidden="true" />} label="Dismiss" onClick={onDismiss} />
    </div>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}
