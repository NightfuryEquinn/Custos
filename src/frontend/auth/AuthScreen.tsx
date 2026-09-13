import { useEnter } from "@/frontend/lib/animate";
import { Brand } from "@/frontend/components/Brand";
import { LoadingBloom } from "@/frontend/components/LoadingBloom";
import { Icon } from "@/frontend/components/ui";
import { api } from "@/frontend/lib/api";
import type { Account, IdentityRecord } from "@/frontend/lib/types";
import { getAddress } from "ethers";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Identicon } from "./components/Identicon";
import {
  checkQuizAnswers,
  isValidPassphrase,
  pickQuizIndices,
  unwrapSecrets,
  wrapSecrets,
} from "./lib/device-vault";
import {
  biometricAutoUnlockIdentity,
  biometricEnrolled,
  biometricSupported,
  enrollBiometric,
  markAskedToEnrollBiometric,
  unlockWithBiometric,
  wasAskedToEnrollBiometric,
} from "./lib/biometric";
import { copyText } from "./lib/clipboard";
import { codenameFor } from "./lib/codename";
import { shortAddr } from "./lib/format";
import { identityStorage } from "./lib/identity-storage";
import { sessionSecrets } from "./lib/session-secrets";
import { unlockLedgerKey } from "@/frontend/lib/crypto/unlock";
import {
  emitNotifyEmailChanged,
  writeCachedNotifyEmail,
} from "@/frontend/lib/hooks/useAccountNotifyEmail";
import { hasSharingChoiceMade, markSharingChoiceMade, setConsent } from "./lib/consent";
import { walletClient } from "./lib/wallet";
import { TermsModal } from "./components/LegalModals";

type DraftWallet = {
  address: string;
  mnemonic: string;
  privateKey: string;
};

type AuthIdn = IdentityRecord & { mnemonic?: string; privateKey?: string };

type AuthScreenProps = {
  onAuth: (account: Account) => void;
};

type AuthMode =
  | "welcome"
  | "create"
  | "quiz"
  | "passphrase"
  | "restore"
  | "device-unlock"
  | "biometric-offer"
  | "consent-choice";

type SharingChoice = "in" | "out";

/** Full-bleed auth page chrome shared by every AuthMode screen. */
function AuthShell({
  children,
  cardRef,
  tight,
}: {
  children: ReactNode;
  cardRef: RefObject<HTMLDivElement | null>;
  tight?: boolean;
}) {
  return (
    <div className="auth-wrap">
      <div className="auth-ambient" aria-hidden="true" />
      <div ref={cardRef} className={`auth-card${tight ? " auth-card--tight" : ""}`}>
        {children}
      </div>
    </div>
  );
}

/** Persist vaulted (or injected) identity, unlock E2EE, and enter the app. */
async function finishAuth(
  idn: AuthIdn,
  onAuth: (account: Account) => void,
  sharingOptIn?: boolean,
) {
  const { message } = await api.auth.challenge(idn.address);
  let signature = await walletClient.sign(idn, message);
  if (Array.isArray(signature)) signature = signature[0]!;
  await api.auth.verify({ address: idn.address, message, signature });
  const codename = codenameFor(idn.address);
  const { user } = await api.users.upsert({ address: idn.address, codename });
  /* Rehydrate after PWA clear: localStorage was wiped, DB still has the email. */
  const savedEmail = user.notifyEmail?.trim() || "";
  writeCachedNotifyEmail(savedEmail);
  if (savedEmail) emitNotifyEmailChanged();

  if (sharingOptIn !== undefined) {
    await api.consent.update(sharingOptIn);
    setConsent(idn.address, sharingOptIn);
    markSharingChoiceMade(idn.address);
  }

  const stored: IdentityRecord = {
    address: idn.address,
    codename,
    injected: !!idn.injected,
    lastSeen: Date.now(),
  };
  if (idn.vault) stored.vault = idn.vault;
  identityStorage.upsert(stored);
  identityStorage.setSession(idn.address);

  if (idn.privateKey && idn.mnemonic) {
    sessionSecrets.set(idn.address, {
      mnemonic: idn.mnemonic,
      privateKey: idn.privateKey,
    });
  }

  await unlockLedgerKey({
    ...idn,
    privateKey: idn.privateKey ?? sessionSecrets.get(idn.address)?.privateKey,
  });
  onAuth({ address: idn.address, codename, injected: !!idn.injected });
}

export function AuthScreen({ onAuth }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>("welcome");
  const [draft, setDraft] = useState<DraftWallet | null>(null);
  const [saved, setSaved] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [phraseCopied, setPhraseCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quizIndices, setQuizIndices] = useState<number[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [passphrase, setPassphrase] = useState("");
  const [passphrase2, setPassphrase2] = useState("");
  const [pendingIdn, setPendingIdn] = useState<IdentityRecord | null>(null);
  const [unlockPass, setUnlockPass] = useState("");
  const [canBiometricUnlock, setCanBiometricUnlock] = useState(false);
  const [offerSource, setOfferSource] = useState<"create" | "unlock" | null>(null);
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerError, setOfferError] = useState("");
  const [pendingUnlockSecrets, setPendingUnlockSecrets] = useState<{
    mnemonic: string;
    privateKey: string;
  } | null>(null);
  const [pendingAuth, setPendingAuth] = useState<AuthIdn | null>(null);
  const [sharingChoice, setSharingChoice] = useState<SharingChoice | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const identities = identityStorage.list();
  const cardRef = useRef<HTMLDivElement>(null);
  useEnter(cardRef);

  const words = useMemo(
    () => (draft?.mnemonic ? draft.mnemonic.split(" ") : []),
    [draft?.mnemonic],
  );

  const reset = () => {
    setMode("welcome");
    setDraft(null);
    setSaved(false);
    setPhrase("");
    setPhraseCopied(false);
    setError("");
    setBusy(false);
    setQuizIndices([]);
    setQuizAnswers({});
    setPassphrase("");
    setPassphrase2("");
    setPendingIdn(null);
    setUnlockPass("");
    setOfferSource(null);
    setOfferBusy(false);
    setOfferError("");
    setPendingUnlockSecrets(null);
    setPendingAuth(null);
    setSharingChoice(null);
    setTermsAccepted(false);
    setTermsOpen(false);
  };

  /**
   * Enter the app, prompting for Terms + sharing choice when this browser
   * has not completed that step for the address yet.
   */
  async function enterWithConsentGate(idn: AuthIdn) {
    if (hasSharingChoiceMade(idn.address)) {
      setBusy(true);
      try {
        await finishAuth(idn, onAuth);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not sign in.");
        setBusy(false);
      }
      return;
    }

    setPendingAuth(idn);
    setSharingChoice(null);
    setTermsAccepted(false);
    setError("");
    setMode("consent-choice");
  }

  /** Persist the signup sharing choice and finish authentication. */
  async function confirmConsentAndEnter() {
    if (!pendingAuth || sharingChoice === null || !termsAccepted) return;

    setBusy(true);
    setError("");
    try {
      await finishAuth(pendingAuth, onAuth, sharingChoice === "in");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in.");
      setBusy(false);
    }
  }

  useEffect(() => {
    if (mode !== "device-unlock" || !pendingIdn) {
      setCanBiometricUnlock(false);
      return;
    }
    let live = true;
    void biometricSupported().then((supported) => {
      if (live) setCanBiometricUnlock(supported && biometricEnrolled(pendingIdn.address));
    });
    return () => {
      live = false;
    };
  }, [mode, pendingIdn]);

  /* Returning user whose server session lapsed: jump straight to their last
     identity's unlock screen so Face ID can prompt with no clicks. */
  const autoRouted = useRef(false);
  useEffect(() => {
    if (autoRouted.current || mode !== "welcome") return;
    const idn = biometricAutoUnlockIdentity();
    if (!idn) return;
    autoRouted.current = true;
    setPendingIdn(idn);
    setMode("device-unlock");
  }, [mode]);

  async function doGenerate() {
    setError("");
    setPhraseCopied(false);
    setBusy(true);
    try {
      setDraft(await walletClient.create());
      setSaved(false);
      setQuizIndices([]);
      setQuizAnswers({});
    } catch {
      setError("Could not generate identity.");
    }
    setBusy(false);
  }

  const startCreate = () => {
    setMode("create");
    setDraft(null);
    setSaved(false);
    void doGenerate();
  };

  /** Advance from phrase screen to the recovery quiz. */
  const startQuiz = () => {
    if (!draft || !saved) return;
    setQuizIndices(pickQuizIndices(words.length, 3));
    setQuizAnswers({});
    setError("");
    setMode("quiz");
  };

  /** After quiz, collect a device passphrase to wrap the vault. */
  const startPassphrase = () => {
    if (!draft) return;
    if (!checkQuizAnswers(words, quizIndices, quizAnswers)) {
      setError("Those words don't match. Check your written phrase and try again.");
      return;
    }
    setError("");
    setPassphrase("");
    setPassphrase2("");
    setMode("passphrase");
  };

  /** Wrap draft secrets and sign in (after any biometric offer is settled). */
  async function completeSeal() {
    if (!draft) return;
    setBusy(true);
    try {
      const vault = await wrapSecrets(passphrase, {
        mnemonic: draft.mnemonic,
        privateKey: draft.privateKey,
      });
      setBusy(false);
      await enterWithConsentGate({
        address: draft.address,
        mnemonic: draft.mnemonic,
        privateKey: draft.privateKey,
        vault,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in.");
      setBusy(false);
    }
  }

  /** Validate the new passphrase, then offer Face ID once before sealing. */
  async function sealAndEnter() {
    if (!draft) return;
    setError("");
    if (!isValidPassphrase(passphrase)) {
      setError("Passphrase must be at least 8 characters.");
      return;
    }
    if (passphrase !== passphrase2) {
      setError("Passphrases do not match.");
      return;
    }
    if ((await biometricSupported()) && !wasAskedToEnrollBiometric(draft.address)) {
      setOfferSource("create");
      setOfferError("");
      setMode("biometric-offer");
      return;
    }
    await completeSeal();
  }

  /** Restore from typed recovery phrase → set device passphrase. */
  async function doImport() {
    setError("");
    setBusy(true);
    try {
      const wallet = await walletClient.fromMnemonic(phrase);
      setDraft(wallet);
      setPassphrase("");
      setPassphrase2("");
      setMode("passphrase");
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That phrase isn't valid.");
      setBusy(false);
    }
  }

  /** Known identity on this device — unlock vault or migrate plaintext. */
  async function selectKnown(idn: IdentityRecord) {
    setError("");
    if (idn.injected) {
      await enterWithConsentGate(idn);
      return;
    }

    const session = sessionSecrets.get(idn.address);
    if (session) {
      await enterWithConsentGate({
        ...idn,
        mnemonic: session.mnemonic,
        privateKey: session.privateKey,
      });
      return;
    }

    if (idn.vault) {
      setPendingIdn(idn);
      setUnlockPass("");
      setMode("device-unlock");
      return;
    }

    /* Legacy plaintext — migrate into a vault. */
    if (idn.mnemonic && idn.privateKey) {
      setDraft({
        address: idn.address,
        mnemonic: idn.mnemonic,
        privateKey: idn.privateKey,
      });
      setPassphrase("");
      setPassphrase2("");
      setMode("passphrase");
      return;
    }

    setError("This identity needs its recovery phrase restored on this device.");
  }

  /** Finish sign-in with already-unwrapped vault secrets. */
  async function completeUnlock(secrets: { mnemonic: string; privateKey: string }) {
    if (!pendingIdn?.vault) return;
    setBusy(false);
    await enterWithConsentGate({
      ...pendingIdn,
      mnemonic: secrets.mnemonic,
      privateKey: secrets.privateKey,
      vault: pendingIdn.vault,
    });
  }

  /** Unlock an existing vault with the device passphrase (or Face ID). */
  async function unlockDeviceVault(passphraseOverride?: string, viaBiometric = false) {
    if (!pendingIdn?.vault) return;
    setError("");
    setBusy(true);
    try {
      const secrets = await unwrapSecrets(passphraseOverride ?? unlockPass, pendingIdn.vault);
      if (
        !viaBiometric &&
        (await biometricSupported()) &&
        !wasAskedToEnrollBiometric(pendingIdn.address)
      ) {
        setBusy(false);
        setPendingUnlockSecrets(secrets);
        setOfferSource("unlock");
        setOfferError("");
        setMode("biometric-offer");
        return;
      }
      await completeUnlock(secrets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlock vault.");
      setBusy(false);
    }
  }

  /** Face ID button on the device-unlock screen. */
  async function biometricUnlock(silent = false) {
    if (!pendingIdn) return;
    setError("");
    if (!silent) setBusy(true);
    let pass: string;
    try {
      pass = await unlockWithBiometric(pendingIdn.address);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Could not unlock with Face ID.");
      setBusy(false);
      return;
    }
    await unlockDeviceVault(pass, true);
  }

  /* Prompt as soon as the unlock screen is ready. Browsers that demand a user
     gesture (WebKit) reject instantly — the button below stays as the fallback. */
  const autoTried = useRef(false);
  useEffect(() => {
    if (!canBiometricUnlock || autoTried.current) return;
    autoTried.current = true;
    void biometricUnlock(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBiometricUnlock]);

  /** Continue past the one-time Face ID offer into the app. */
  async function proceedAfterOffer() {
    const source = offerSource;
    setOfferSource(null);
    if (source === "create") {
      await completeSeal();
    } else if (source === "unlock" && pendingUnlockSecrets) {
      const secrets = pendingUnlockSecrets;
      setPendingUnlockSecrets(null);
      await completeUnlock(secrets);
    }
  }

  async function acceptBiometricOffer() {
    const address = offerSource === "create" ? draft?.address : pendingIdn?.address;
    if (!address) {
      await proceedAfterOffer();
      return;
    }
    const codename =
      offerSource === "create"
        ? codenameFor(address)
        : pendingIdn?.codename || codenameFor(address);
    const passphraseValue = offerSource === "create" ? passphrase : unlockPass;
    setOfferBusy(true);
    setOfferError("");
    try {
      const ok = await enrollBiometric(address, codename, passphraseValue);
      if (!ok) setOfferError("Face ID isn't available on this device. Continuing without it.");
    } catch {
      setOfferError("Could not set up Face ID. Continuing without it.");
    }
    markAskedToEnrollBiometric(address);
    setOfferBusy(false);
    await proceedAfterOffer();
  }

  function declineBiometricOffer() {
    const address = offerSource === "create" ? draft?.address : pendingIdn?.address;
    if (address) markAskedToEnrollBiometric(address);
    void proceedAfterOffer();
  }

  async function connectInjected() {
    if (busy) return;

    setError("");
    if (!walletClient.hasInjected()) {
      setError("No browser wallet detected on this device.");
      return;
    }

    setBusy(true);
    try {
      const accs = await window.ethereum!.request({ method: "eth_requestAccounts" });
      const address = getAddress(accs[0]!);
      await enterWithConsentGate({ address, injected: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connection was cancelled.");
      setBusy(false);
    }
  }

  if (mode === "create" && !draft) {
    return (
      <AuthShell cardRef={cardRef} tight>
        <div className="gen-load">
          <LoadingBloom label="Generating your keys…" />
        </div>
      </AuthShell>
    );
  }

  if (mode === "create" && draft) {
    return (
      <AuthShell cardRef={cardRef} tight>
        <button className="auth-back" type="button" onClick={reset}>
          ← Back
        </button>
        <h2 className="auth-h2">Meet Your New Identity</h2>
        <div className="identity-hero">
          <Identicon address={draft.address} size={54} radius={15} />
          <div>
            <div className="ih-name">{codenameFor(draft.address)}</div>
            <div className="ih-addr num">{shortAddr(draft.address)}</div>
          </div>
        </div>
        <div className="recovery">
          <div className="rec-label">
            <Icon name="key" size={15} /> Recovery Phrase{" "}
            <span className="rec-warn">— write this down</span>
          </div>
          <div className="phrase-grid">
            {words.map((w, i) => (
              <span key={i} className="word">
                <b>{i + 1}</b>
                {w}
              </span>
            ))}
          </div>
          <div className="rec-row2">
            <button
              className="mini-btn"
              type="button"
              onClick={() => {
                copyText(draft.mnemonic);
                setPhraseCopied(true);
                setTimeout(() => setPhraseCopied(false), 1200);
              }}
            >
              <Icon name={phraseCopied ? "check" : "copy"} size={14} />{" "}
              {phraseCopied ? "Copied" : "Copy"}
            </button>
            <button className="mini-btn" type="button" onClick={doGenerate}>
              <Icon name="repeat" size={14} /> Regenerate
            </button>
          </div>
        </div>
        <p className="rec-note2">
          This phrase is the only way to recover your ledger. We can't reset it, and anyone who has
          it controls your data.
        </p>
        <label className="toggle-line">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />{" "}
          <span className="toggle-ui" /> I've saved my recovery phrase
        </label>
        {error ? <div className="auth-error">{error}</div> : null}
        <button
          className="primary-btn lg full"
          type="button"
          disabled={!saved || busy}
          onClick={startQuiz}
        >
          Continue
        </button>
      </AuthShell>
    );
  }

  if (mode === "quiz" && draft) {
    return (
      <AuthShell cardRef={cardRef} tight>
        <button
          className="auth-back"
          type="button"
          onClick={() => {
            setMode("create");
            setError("");
          }}
        >
          ← Back
        </button>
        <h2 className="auth-h2">Confirm Your Phrase</h2>
        <p className="auth-lead">
          Enter the requested words from your recovery phrase to make sure you wrote them down.
        </p>
        <div className="vault-quiz">
          {quizIndices.map((idx) => (
            <label key={idx} className="fld-label vault-quiz-row">
              Word {idx + 1}
              <input
                className="text-in"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={quizAnswers[idx] ?? ""}
                onChange={(e) => setQuizAnswers((prev) => ({ ...prev, [idx]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {error ? <div className="auth-error">{error}</div> : null}
        <button className="primary-btn lg full" type="button" onClick={startPassphrase}>
          Continue
        </button>
      </AuthShell>
    );
  }

  if (mode === "passphrase" && draft) {
    return (
      <AuthShell cardRef={cardRef} tight>
        <button
          className="auth-back"
          type="button"
          onClick={() => {
            setMode(quizIndices.length ? "quiz" : "restore");
            setError("");
          }}
        >
          ← Back
        </button>
        <h2 className="auth-h2">Device Passphrase</h2>
        <p className="auth-lead">
          Encrypt your recovery key on this device. The server never receives this passphrase — only
          ciphertext syncs to the cloud.
        </p>
        <label className="fld-label">
          Passphrase
          <input
            className="text-in"
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
        <label className="fld-label">
          Confirm passphrase
          <input
            className="text-in"
            type="password"
            autoComplete="new-password"
            value={passphrase2}
            onChange={(e) => setPassphrase2(e.target.value)}
          />
        </label>
        <p className="rec-note2">
          At least 8 characters. You will need this passphrase to unlock Custos on this browser.
        </p>
        {error ? <div className="auth-error">{error}</div> : null}
        <button
          className="primary-btn lg full"
          type="button"
          disabled={busy}
          onClick={() => void sealAndEnter()}
        >
          {busy ? "Signing…" : "Sign & Enter Ledger"}
        </button>
      </AuthShell>
    );
  }

  if (mode === "device-unlock" && pendingIdn) {
    return (
      <AuthShell cardRef={cardRef} tight>
        <button
          className="auth-back"
          type="button"
          onClick={() => {
            setMode("restore");
            setPendingIdn(null);
            setError("");
          }}
        >
          ← Back
        </button>
        <h2 className="auth-h2">Unlock this Device</h2>
        <p className="auth-lead">Enter the passphrase that encrypts your key on this browser.</p>
        <div className="identity-hero">
          <Identicon address={pendingIdn.address} size={44} radius={12} />
          <div>
            <div className="ih-name">{pendingIdn.codename || codenameFor(pendingIdn.address)}</div>
            <div className="ih-addr num">{shortAddr(pendingIdn.address)}</div>
          </div>
        </div>
        {canBiometricUnlock ? (
          <button
            className="primary-btn lg full face-id-btn"
            type="button"
            disabled={busy}
            onClick={() => void biometricUnlock()}
          >
            <Icon name="shield" size={17} /> Unlock with Face ID
          </button>
        ) : null}
        <label className="fld-label">
          {canBiometricUnlock ? "Or enter your passphrase" : "Device Passphrase"}
          <input
            className="text-in"
            type="password"
            autoComplete="current-password"
            value={unlockPass}
            onChange={(e) => setUnlockPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void unlockDeviceVault();
            }}
          />
        </label>
        {error ? <div className="auth-error">{error}</div> : null}
        <button
          className={canBiometricUnlock ? "ghost-btn lg full" : "primary-btn lg full"}
          type="button"
          disabled={busy || !unlockPass}
          onClick={() => void unlockDeviceVault()}
        >
          {busy ? "Unlocking…" : "Unlock & Sign In"}
        </button>
      </AuthShell>
    );
  }

  if (mode === "biometric-offer") {
    return (
      <AuthShell cardRef={cardRef} tight>
        <h2 className="auth-h2">Use Face ID on this Device?</h2>
        <p className="auth-lead">
          Next time, Custos will ask for Face ID or Touch ID on its own — no need to type your
          passphrase. Your passphrase is encrypted with your biometric key and never leaves this
          device.
        </p>
        {offerError ? <div className="auth-error">{offerError}</div> : null}
        <button
          className="primary-btn lg full"
          type="button"
          disabled={offerBusy}
          onClick={() => void acceptBiometricOffer()}
        >
          <Icon name="shield" size={17} /> {offerBusy ? "Setting up…" : "Enable Face ID"}
        </button>
        <button
          className="ghost-btn lg full u-gap-top"
          type="button"
          disabled={offerBusy}
          onClick={declineBiometricOffer}
        >
          Not Now
        </button>
      </AuthShell>
    );
  }

  if (mode === "consent-choice" && pendingAuth) {
    const canContinue = termsAccepted && sharingChoice !== null && !busy;

    return (
      <>
        <AuthShell cardRef={cardRef} tight>
          <h2 className="auth-h2">Before You Enter</h2>
          <p className="auth-lead">
            Custos is free on the official host with full features. We are a freemium,
            customer-based app — optional anonymized insights help us keep the lights on. Your
            encrypted amounts, titles, and notes stay private either way.
          </p>

          <div className="consent-card auth-share-card">
            <div className="consent-title">Optional data sharing</div>
            <p className="consent-desc">
              Opt in to share de-identified category totals with vetted research and advertising
              partners — not your name, wallet address, notes, or decrypted ledger amounts. You can
              change this anytime under Account → Data &amp; privacy.
            </p>
            <div className="auth-share-choices" role="radiogroup" aria-label="Data sharing choice">
              <button
                type="button"
                className={`auth-share-choice${sharingChoice === "in" ? " is-selected" : ""}`}
                aria-pressed={sharingChoice === "in"}
                disabled={busy}
                onClick={() => setSharingChoice("in")}
              >
                <span className="auth-share-choice-label">Opt in</span>
                <span className="auth-share-choice-hint">Share anonymized category totals</span>
              </button>
              <button
                type="button"
                className={`auth-share-choice${sharingChoice === "out" ? " is-selected" : ""}`}
                aria-pressed={sharingChoice === "out"}
                disabled={busy}
                onClick={() => setSharingChoice("out")}
              >
                <span className="auth-share-choice-label">Opt out</span>
                <span className="auth-share-choice-hint">
                  Do not share — free features unchanged
                </span>
              </button>
            </div>
          </div>

          <label className="toggle-line auth-terms-line">
            <input
              type="checkbox"
              checked={termsAccepted}
              disabled={busy}
              onChange={(e) => setTermsAccepted(e.target.checked)}
            />
            <span className="toggle-ui" />
            <span>
              I agree to the{" "}
              <button
                type="button"
                className="link-btn auth-terms-link"
                onClick={() => setTermsOpen(true)}
              >
                Terms &amp; Conditions
              </button>
            </span>
          </label>

          {error ? <div className="auth-error">{error}</div> : null}
          <button
            className="primary-btn lg full"
            type="button"
            disabled={!canContinue}
            onClick={() => void confirmConsentAndEnter()}
          >
            {busy ? "Signing…" : "Continue to Ledger"}
          </button>
        </AuthShell>
        {termsOpen ? <TermsModal onClose={() => setTermsOpen(false)} /> : null}
      </>
    );
  }

  if (mode === "restore") {
    return (
      <AuthShell cardRef={cardRef} tight>
        <button className="auth-back" type="button" onClick={reset}>
          ← Back
        </button>
        <h2 className="auth-h2">Welcome Back</h2>
        {identities.length ? (
          <div className="known">
            <span className="known-label">On this device</span>
            {identities.map((i) => (
              <button
                key={i.address}
                className="known-row"
                type="button"
                disabled={busy}
                onClick={() => void selectKnown(i)}
              >
                <Identicon address={i.address} size={40} />
                <span className="kr-main">
                  <span className="kr-name">{i.codename || codenameFor(i.address)}</span>
                  <span className="kr-addr num">{shortAddr(i.address)}</span>
                </span>
                <Icon name="chevR" size={18} />
              </button>
            ))}
          </div>
        ) : null}
        <div className="or-div">
          <span>import a recovery phrase</span>
        </div>
        <textarea
          className="phrase-in"
          placeholder="Enter your 12- or 24-word recovery phrase, separated by spaces"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
        {error ? <div className="auth-error">{error}</div> : null}
        <button
          className="primary-btn lg full"
          type="button"
          disabled={busy || !phrase.trim()}
          onClick={() => void doImport()}
        >
          {busy ? "Restoring…" : "Restore Identity"}
        </button>
        {walletClient.hasInjected() ? (
          <button
            className="ghost-btn full u-gap-top"
            type="button"
            disabled={busy}
            onClick={() => void connectInjected()}
          >
            <Icon name="wallet" size={17} /> {busy ? "Connecting…" : "Connect Browser Wallet"}
          </button>
        ) : null}
      </AuthShell>
    );
  }

  return (
    <AuthShell cardRef={cardRef}>
      <Brand variant="auth" />
      <h1 className="auth-h1">Private by Design.</h1>
      <p className="auth-lead">No email. No password. Just a cryptographic key only you hold.</p>
      <div className="auth-actions">
        <button className="primary-btn lg" type="button" onClick={startCreate}>
          <Icon name="shield" size={18} /> Create New
        </button>
        <button
          className="ghost-btn lg"
          type="button"
          onClick={() => {
            setError("");
            setMode("restore");
          }}
        >
          <Icon name="key" size={17} /> Open Existing
        </button>
      </div>
      {walletClient.hasInjected() ? (
        <button
          className="link-btn auth-injected"
          type="button"
          disabled={busy}
          onClick={() => void connectInjected()}
        >
          {busy ? "Connecting…" : "Or Connect Your Browser Wallet"}
        </button>
      ) : null}
      {error ? <div className="auth-error auth-error--gap">{error}</div> : null}
    </AuthShell>
  );
}
