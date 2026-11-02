import type { Blocker } from "react-router";
import { ConfirmDialog } from "../ui/Dialog";

/** Shown when a navigation is blocked by an unsaved form. */
export function UnsavedDialog({ blocker }: { blocker: Blocker }) {
  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      title="Discard unsaved changes?"
      confirmLabel="Discard changes"
      onConfirm={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    >
      <p>You have edits that haven't been saved. If you leave this page now, they will be lost.</p>
    </ConfirmDialog>
  );
}
