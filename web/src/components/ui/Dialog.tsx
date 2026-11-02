import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./controls";
import c from "./controls.module.css";

/**
 * Modal built on the native <dialog>: the browser handles the focus trap, Escape and inert
 * background. Focus returns to whatever opened it.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      (opener.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={wide ? `${c.dialog} ${c.wide}` : c.dialog}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <div className={c.dialogHead}>
            <h2 id="dialog-title" className={c.dialogTitle}>
              {title}
            </h2>
            <Button variant="ghost" size="sm" icon={<X size={18} aria-hidden="true" />} label="Close" onClick={onClose} />
          </div>
          <div className={c.dialogBody}>{children}</div>
          {footer && <div className={c.dialogFoot}>{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** A destructive action asks first, says exactly what will happen, and defaults to Cancel. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="dangerSolid" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
