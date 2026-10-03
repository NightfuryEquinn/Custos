/**
 * Tiny global store for toasts and imperative confirmations. Kept free of
 * React components so low-level hooks (useModalMotion) can open a confirm
 * without a circular import; <FeedbackHost /> renders it.
 */

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  pendingLabel?: string;
  danger?: boolean;
  /** Two-step button: first press arms, second press confirms. Default true. */
  arm?: boolean;
  /** Exact text the user must type before the button enables. */
  requireText?: string;
  onConfirm: () => void | Promise<void>;
};

export type Toast = { id: number; message: string };

type FeedbackState = { toasts: Toast[]; confirm: ConfirmRequest | null };

const TOAST_MS = 3200;

let state: FeedbackState = { toasts: [], confirm: null };
let nextToastId = 0;
const listeners = new Set<() => void>();

/** Replace the state and notify subscribers. */
function set(next: FeedbackState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribeFeedback(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFeedback() {
  return state;
}

/** Show a short status notice. Offline saves say they will sync later. */
export function toast(message: string) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const id = ++nextToastId;
  set({
    ...state,
    toasts: [
      ...state.toasts,
      { id, message: offline ? `${message} · syncs when online` : message },
    ],
  });
  setTimeout(() => set({ ...state, toasts: state.toasts.filter((t) => t.id !== id) }), TOAST_MS);
}

/** Open a confirmation dialog from anywhere, without local dialog state. */
export function openConfirm(request: ConfirmRequest) {
  set({ ...state, confirm: request });
}

export function closeConfirm() {
  set({ ...state, confirm: null });
}
