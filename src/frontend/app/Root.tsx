import { LedgerApp } from "@/frontend/app/LedgerApp";
import { AuthScreen, getSavedAccount, logoutSession, UnlockScreen } from "@/frontend/auth";
import { TermsGate } from "@/frontend/auth/components/TermsGate";
import { LoadingBloom } from "@/frontend/components/LoadingBloom";
import { ThemeToggle } from "@/frontend/components/ThemeToggle";
import { api } from "@/frontend/lib/api";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { unlockLedgerKey } from "@/frontend/lib/crypto/unlock";
import { identityStorage } from "@/frontend/auth/lib/identity-storage";
import { sessionSecrets } from "@/frontend/auth/lib/session-secrets";
import { ThemeProvider } from "@/frontend/lib/hooks/useTheme";
import { TERMS_VERSION } from "@/lib/legal";
import type { Account } from "@/frontend/lib/types";
import { useEffect, useState } from "react";

/**
 * App root: restores the server session on boot, then renders either
 * the authenticated LedgerApp or the AuthScreen.
 */
export function Root() {
  const [account, setAccount] = useState<Account | null>(null);
  const [booting, setBooting] = useState(true);
  const [cryptoReady, setCryptoReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [termsVersion, setTermsVersion] = useState<string | undefined>(undefined);
  const [termsChecked, setTermsChecked] = useState(false);

  /** Re-fetch whether this account has accepted the current Terms. */
  const checkTerms = () => {
    setTermsChecked(false);
    api.profile
      .get()
      .then(({ profile }) => setTermsVersion(profile.termsVersion))
      .catch(() => setTermsVersion(undefined))
      .finally(() => setTermsChecked(true));
  };

  // Restore session; prefer locally-stored codename when it matches.
  useEffect(() => {
    checkTerms(); // fired alongside auth.me() below — same session cookie, no added latency
    api.auth
      .me()
      .then(async ({ account: remote }) => {
        const local = getSavedAccount();
        const merged =
          local && local.address.toLowerCase() === remote.address.toLowerCase()
            ? { ...remote, codename: local.codename, injected: local.injected }
            : remote;
        setAccount(merged);
        const idn = identityStorage.find(merged.address);
        const session = sessionSecrets.get(merged.address);
        /* Only auto-unlock from in-memory sessionSecrets — never from localStorage plaintext. */
        const privateKey = session?.privateKey;
        if (privateKey && !idn?.injected) {
          try {
            await unlockLedgerKey({
              ...idn!,
              privateKey,
              mnemonic: session.mnemonic,
            });
            setCryptoReady(true);
          } catch {
            setCryptoReady(false);
          }
        }
      })
      .catch(() => setAccount(null))
      .finally(() => setBooting(false));
  }, []);

  const signOut = async () => {
    if (signingOut) return;

    setSigningOut(true);
    try {
      ledgerKeyStore.clear();
      sessionSecrets.clearAll();
      await logoutSession();
      setAccount(null);
      setCryptoReady(false);
      setTermsVersion(undefined);
      setTermsChecked(false);
    } finally {
      setSigningOut(false);
    }
  };

  if (booting || (account && !termsChecked)) {
    return (
      <ThemeProvider>
        <div className="app app--loading">
          <LoadingBloom />
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      {account ? (
        termsVersion !== TERMS_VERSION ? (
          <TermsGate onAccepted={setTermsVersion} onSignOut={signOut} signingOut={signingOut} />
        ) : cryptoReady || ledgerKeyStore.isUnlocked(account.address) ? (
          <LedgerApp
            key={account.address}
            account={account}
            onSignOut={signOut}
            signingOut={signingOut}
          />
        ) : (
          <UnlockScreen
            account={account}
            onUnlocked={() => setCryptoReady(true)}
            onSignOut={signOut}
            signingOut={signingOut}
          />
        )
      ) : (
        <>
          <ThemeToggle className="auth-theme-toggle" />
          <AuthScreen
            onAuth={(acc) => {
              setAccount(acc);
              setCryptoReady(true);
              checkTerms();
            }}
          />
        </>
      )}
    </ThemeProvider>
  );
}
