import { Icon } from "@/frontend/components/ui";
import { useModalMotion } from "@/frontend/lib/animate";
import {
  disablePush,
  enablePush,
  pushStatus,
  type PushStatus,
} from "@/frontend/lib/push/subscribe";
import type { Account } from "@/frontend/lib/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  biometricEnrolled,
  biometricSupported,
  disableBiometric,
  enrollBiometric,
} from "../lib/biometric";
import { unwrapSecrets } from "../lib/device-vault";
import { identityStorage } from "../lib/identity-storage";
import { codenameFor } from "../lib/codename";

/*
 * Preferences modal
 * ──────────────────
 * Per-device settings:
 *   1. Push notifications — Web Push reminders for this device
 *   2. Face ID            — biometric unlock instead of the device passphrase
 */

type PreferencesModalProps = {
  account: Account;
  onClose: () => void;
};

/* Unlike the other preference toggles, a failure here is not silently
   reverted — a denied permission can only be undone in browser settings. */
const FAILURE_NOTE: Record<string, string> = {
  unsupported:
    "This browser cannot receive push notifications. On iPhone or iPad, add Custos to your Home Screen first.",
  denied:
    "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
  unconfigured: "Push notifications are not configured on this server yet.",
  failed: "Could not enable notifications. Please try again.",
};

export function PreferencesModal({ account, onClose }: PreferencesModalProps) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const idn = identityStorage.find(account.address);
  const hasVault = !!idn?.vault;
  const [bioSupported, setBioSupported] = useState(false);
  const [bioOn, setBioOn] = useState(() => biometricEnrolled(account.address));
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState("");
  const [bioConfirmPass, setBioConfirmPass] = useState("");
  const [bioConfirming, setBioConfirming] = useState(false);

  useEffect(() => {
    pushStatus()
      .then(setStatus)
      .catch(() => setStatus({ supported: false, permission: "default", subscribed: false }));
    void biometricSupported().then(setBioSupported);
  }, []);

  const toggle = async () => {
    if (!status) return;
    setBusy(true);
    setNote("");
    try {
      if (status.subscribed) {
        await disablePush();
      } else {
        const result = await enablePush();
        if (!result.ok) setNote(FAILURE_NOTE[result.reason] ?? FAILURE_NOTE.failed!);
      }
      setStatus(await pushStatus());
    } catch {
      setNote(FAILURE_NOTE.failed!);
    } finally {
      setBusy(false);
    }
  };

  const startBioEnroll = () => {
    setBioError("");
    setBioConfirmPass("");
    setBioConfirming(true);
  };

  const confirmBioEnroll = async () => {
    if (!idn?.vault) return;
    setBioBusy(true);
    setBioError("");
    try {
      await unwrapSecrets(bioConfirmPass, idn.vault);
    } catch {
      setBioError("Wrong passphrase.");
      setBioBusy(false);
      return;
    }
    try {
      const ok = await enrollBiometric(
        account.address,
        idn.codename || codenameFor(account.address),
        bioConfirmPass,
      );
      if (ok) {
        setBioOn(true);
        setBioConfirming(false);
        setBioConfirmPass("");
      } else {
        setBioError("Face ID isn't available on this device.");
      }
    } catch {
      setBioError("Could not set up Face ID.");
    } finally {
      setBioBusy(false);
    }
  };

  const disableBio = () => {
    disableBiometric(account.address);
    setBioOn(false);
  };

  const on = status?.subscribed === true;
  const unsupported = status !== null && !status.supported;
  const modalBusy = busy || bioBusy;
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !modalBusy) requestClose(onClose);
      }}
    >
      <div ref={panelRef} className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Preferences</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={() => requestClose(onClose)}
            aria-label="Close"
            disabled={modalBusy}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="modal-body modal-scroll">
          <div className="dm-sec">
            <span className="fld-label">Push notifications</span>
            <p className="dm-lead">
              Get event reminders on this device at the same time the reminder email goes out — even
              when Custos is closed. Reminders are checked every 15 minutes.
            </p>
            <div className="consent-card">
              <div className="consent-top">
                <div>
                  <div className="consent-title">Notify Me On This Device</div>
                  <p className="consent-desc">
                    The notification shows the event name, time and any budget hold or comments you
                    saved with it — the same details as the email. Each device is enabled
                    separately, and turning this off here does not affect your other devices or your
                    reminder emails.
                  </p>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy || status === null || unsupported}
                    onChange={toggle}
                  />
                  <span className="toggle-ui" />
                </label>
              </div>
              <div className={`consent-status ${on ? "cs-on" : "cs-off"}`}>
                <span className="cs-dot" />
                {status === null
                  ? "Checking this device…"
                  : unsupported
                    ? "Not available in this browser"
                    : on
                      ? "Enabled — reminders will notify this device"
                      : "Disabled — no push notifications on this device"}
              </div>
            </div>
            {note ? <p className="dm-note">{note}</p> : null}
            {unsupported ? <p className="dm-note">{FAILURE_NOTE.unsupported}</p> : null}
          </div>

          {hasVault ? (
            <>
              <div className="dm-div" />
              <div className="dm-sec">
                <span className="fld-label">Face ID</span>
                <p className="dm-lead">
                  Unlock Custos on this device with Face ID or Touch ID instead of typing your
                  device passphrase. Once enabled, the unlock screen prompts on its own when you
                  open the app — no button press needed.
                </p>
                <div className="consent-card">
                  <div className="consent-top">
                    <div>
                      <div className="consent-title">Unlock With Face ID</div>
                      <p className="consent-desc">
                        Your passphrase is encrypted with a key tied to your biometric check and
                        never leaves this device. Turning this off removes it from Custos — the
                        saved Face ID/Touch ID entry itself stays in your device's settings until
                        removed there.
                      </p>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={bioOn}
                        disabled={bioBusy || !bioSupported}
                        onChange={() => (bioOn ? disableBio() : startBioEnroll())}
                      />
                      <span className="toggle-ui" />
                    </label>
                  </div>
                  <div className={`consent-status ${bioOn ? "cs-on" : "cs-off"}`}>
                    <span className="cs-dot" />
                    {!bioSupported
                      ? "Not available on this device"
                      : bioOn
                        ? "Enabled — Face ID can unlock this device"
                        : "Disabled — use your device passphrase to unlock"}
                  </div>
                </div>
                {bioConfirming ? (
                  <label className="fld u-gap-top">
                    <p className="dm-subhead">Confirm your device passphrase</p>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        className="text-in"
                        type="password"
                        autoComplete="current-password"
                        value={bioConfirmPass}
                        onChange={(e) => setBioConfirmPass(e.target.value)}
                        disabled={bioBusy}
                        style={{ flex: 1 }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void confirmBioEnroll();
                        }}
                      />
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={bioBusy || !bioConfirmPass}
                        onClick={() => void confirmBioEnroll()}
                      >
                        {bioBusy ? "Checking…" : "Confirm"}
                      </button>
                    </div>
                  </label>
                ) : null}
                {bioError ? <p className="dm-note">{bioError}</p> : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
