import { ConfirmDialog } from "@/frontend/components/ui";
import { closeConfirm, getFeedback, subscribeFeedback } from "@/frontend/lib/feedback";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/** Renders toasts and the imperative confirm dialog. Mount once, inside the app root. */
export function FeedbackHost() {
  const { toasts, confirm } = useSyncExternalStore(subscribeFeedback, getFeedback, getFeedback);

  return (
    <>
      {confirm ? (
        <ConfirmDialog
          {...confirm}
          onConfirm={async () => {
            await confirm.onConfirm();
            closeConfirm();
          }}
          onCancel={closeConfirm}
        />
      ) : null}
      {createPortal(
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              {t.message}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
