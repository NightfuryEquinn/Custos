import { Brand } from "@/frontend/components/Brand";
import { useEnter } from "@/frontend/lib/animate";
import { api } from "@/frontend/lib/api";
import { TERMS_UPDATED, TERMS_VERSION } from "@/lib/legal";
import { useRef, useState } from "react";
import { TermsModal } from "./LegalModals";

type TermsGateProps = {
  /** Called with the accepted version straight from the PATCH response —
      the caller must not re-GET, since /profile's 30s cache can still hold
      the pre-accept value for a few seconds after this write lands. */
  onAccepted: (termsVersion: string | undefined) => void;
  onSignOut: () => void;
  signingOut?: boolean;
};

/**
 * Blocking re-acceptance screen shown when the signed-in account's stored
 * `termsVersion` does not match the current `TERMS_VERSION` — covers both a
 * brand-new profile and an existing account after a Terms update, on every
 * device, because the record lives on the profile rather than in
 * localStorage.
 */
export function TermsGate({ onAccepted, onSignOut, signingOut = false }: TermsGateProps) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [termsOpen, setTermsOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useEnter(cardRef);

  const accept = async () => {
    if (!checked || busy) return;
    setBusy(true);
    setError("");
    try {
      const { profile } = await api.profile.update({ termsVersion: TERMS_VERSION });
      onAccepted(profile.termsVersion);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="auth-wrap">
        <div className="auth-ambient" aria-hidden="true" />
        <div ref={cardRef} className="auth-card">
          <Brand variant="auth" />
          <h1 className="auth-h1">Terms Have Changed</h1>
          <p className="auth-lead">
            Updated {TERMS_UPDATED}. Continuing means accepting the current Terms &amp; Conditions.
          </p>
          <button type="button" className="link-btn u-gap-top" onClick={() => setTermsOpen(true)}>
            Read the full Terms &amp; Conditions
          </button>
          <label className="toggle-line auth-terms-line u-gap-top">
            <input
              type="checkbox"
              checked={checked}
              disabled={busy}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span className="toggle-ui" />
            <span>I agree to the Terms &amp; Conditions</span>
          </label>
          {error ? <div className="auth-error">{error}</div> : null}
          <button
            className="primary-btn lg full"
            type="button"
            disabled={!checked || busy}
            onClick={() => void accept()}
          >
            {busy ? "Saving…" : "Continue"}
          </button>
          <button
            className="ghost-btn full u-gap-top"
            type="button"
            disabled={busy || signingOut}
            onClick={onSignOut}
          >
            {signingOut ? "Signing Out…" : "Sign Out"}
          </button>
        </div>
      </div>
      {termsOpen ? <TermsModal onClose={() => setTermsOpen(false)} /> : null}
    </>
  );
}
