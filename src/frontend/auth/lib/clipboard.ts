/** How long a copied secret (recovery phrase) stays on the clipboard before we clear it. */
const SECRET_CLIPBOARD_CLEAR_MS = 30_000;

/** Copy non-secret text (e.g. an address) to the clipboard. */
export function copyText(text: string): void {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      /* ignore */
    }
    ta.remove();
  }
}

/**
 * Copy a secret (recovery phrase) to the clipboard. Unlike `copyText`, this
 * never falls back to a DOM `<textarea>` — that fallback briefly puts the
 * secret in the page's DOM, which a reveal is otherwise careful to avoid —
 * and it auto-clears the clipboard after a short delay so the phrase isn't
 * sitting there indefinitely, readable by any other app or synced to other
 * devices via Universal/Cloud Clipboard.
 *
 * The clear is unconditional (it does not re-read the clipboard first —
 * `clipboard-read` is a separate, stricter permission browsers may not
 * grant this long after the user's copy gesture): if the user copied
 * something else in the meantime, that gets cleared too. A false-positive
 * clear of an unrelated, non-secret copy is the acceptable side of that
 * trade against leaving a recovery phrase on the clipboard.
 *
 * The realistic next step after copying a recovery phrase is switching to a
 * password manager or notes app — at which point the tab loses focus, and a
 * plain `setTimeout` fires *after* that against an unfocused document,
 * where `clipboard.writeText` typically rejects with `NotAllowedError` and
 * silently leaves the phrase in place indefinitely. Clearing immediately on
 * `visibilitychange`/`pagehide` (while the page is still the one holding
 * clipboard-write permission) closes that gap; the timer remains as a
 * fallback for the case where the tab just stays open and focused.
 */
export function copySecret(text: string): void {
  try {
    void navigator.clipboard.writeText(text).catch(() => {
      /* Rejected copy — nothing landed on the clipboard, so there's nothing
         for the clear-triggers below to undo; they still get registered
         and remain harmless no-ops. */
    });
  } catch {
    return;
  }

  let cleared = false;
  const clear = () => {
    if (cleared) return;
    cleared = true;
    navigator.clipboard.writeText("").catch(() => {
      /* Clipboard may be unavailable (unfocused tab, permission revoked) — ignore. */
    });
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("pagehide", clear);
  };
  const onHidden = () => {
    if (document.hidden) clear();
  };
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", clear);
  setTimeout(clear, SECRET_CLIPBOARD_CLEAR_MS);
}
