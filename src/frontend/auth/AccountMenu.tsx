import { useSearchReveal, focusSearchRecord } from "@/frontend/lib/search/reveal";
import { useFadeIn } from "@/frontend/lib/animate";
import { ACCOUNT_STALE_DAYS } from "@/lib/account-retention";
import { APP_VERSION } from "@/lib/version";
import { TimezonePicker } from "@/frontend/components/TimezonePicker";
import { Icon } from "@/frontend/components/ui";
import { api } from "@/frontend/lib/api";
import { dailyTimezoneKey } from "@/frontend/lib/hooks/useDaily";
import type { NavItem } from "@/frontend/lib/nav";
import type { Account, ViewId } from "@/frontend/lib/types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { DataPrivacyModal } from "./components/DataPrivacyModal";
import { ImportExportModal } from "./components/ImportExportModal";
import { Identicon } from "./components/Identicon";
import { CopyrightModal, TermsModal } from "./components/LegalModals";
import { NavigationModal } from "./components/NavigationModal";
import { PreferencesModal } from "./components/PreferencesModal";
import { RecoveryReveal } from "./components/RecoveryReveal";
import { SupportModal } from "./components/SupportModal";
import { copyText } from "./lib/clipboard";
import { shortAddr } from "./lib/format";
import { identityStorage } from "./lib/identity-storage";
import { sessionSecrets } from "./lib/session-secrets";

/** Resolve the browser's IANA timezone, falling back to UTC. */
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * "09/26" from an ISO timestamp — the month and year a supporter chip reads
 * "Since". UTC, so the same grant reads the same in every timezone.
 */
function supporterChipDate(iso: string): string {
  const d = new Date(iso);

  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(-2)}`;
}

type AccountMenuProps = Omit<
  ComponentProps<typeof ImportExportModal>,
  "accountAddress" | "onClose"
> & {
  account: Account;
  onSignOut: () => void;
  signingOut?: boolean;
  onTakeTour?: () => void;
  onWhatsNew?: () => void;
  navSidebarItems: readonly NavItem[];
  navTabItems: readonly NavItem[];
  onSaveNavPrefs: (prefs: {
    navOrder: ViewId[];
    navTabs: ViewId[];
    startView?: ViewId;
  }) => Promise<unknown>;
  startView?: ViewId;
};

export function AccountMenu({
  account,
  onSignOut,
  signingOut = false,
  onTakeTour,
  onWhatsNew,
  navSidebarItems,
  navTabItems,
  onSaveNavPrefs,
  startView,
  ...importExportProps
}: AccountMenuProps) {
  useSearchReveal(["setting"], (target) => {
    if (
      target.id === "recovery" &&
      !(stored?.vault || stored?.mnemonic || sessionSecrets.get(account.address)?.mnemonic)
    )
      return false;
    const openers: Record<string, () => void> = {
      preferences: () => setPrefsOpen(true),
      navigation: () => setNavOpen(true),
      privacy: () => setDataOpen(true),
      exports: () => setCsvOpen(true),
      recovery: () => setReveal(true),
      support: () => setSupportOpen(true),
      terms: () => setTermsOpen(true),
      copyright: () => setCopyrightOpen(true),
      tour: () => onTakeTour?.(),
      timezone: () => {
        setOpen(true);
        focusSearchRecord("timezone");
      },
      appearance: () => {
        focusSearchRecord("appearance");
      },
    };
    const open = openers[target.id];
    if (!open) return false;
    open();
    return true;
  });
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [copyrightOpen, setCopyrightOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supporterSince, setSupporterSince] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [timezone, setTimezone] = useState(() => browserTimezone());
  const [timezoneSaved, setTimezoneSaved] = useState(false);
  const [tzBusy, setTzBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useFadeIn(menuRef, { active: open });

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  useEffect(() => {
    api.users
      .me()
      .then(({ user }) => {
        setSupporterSince(user.supporterSince);
        if (user.timezone) {
          setTimezone(user.timezone);
          setTimezoneSaved(true);
          return;
        }
        /* No timezone stored yet: persist the browser's zone so server-side
           reminder times match what the UI shows instead of the app default. */
        const tz = browserTimezone();
        api.users
          .updateMe({ timezone: tz })
          .then(() => {
            setTimezone(tz);
            setTimezoneSaved(true);
            void queryClient.invalidateQueries({
              queryKey: dailyTimezoneKey(account.address.toLowerCase()),
            });
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, [account.address, queryClient]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Portaled pickers render outside `.acct`; ignore their interactions.
      if (target?.closest?.(".picker-scrim")) return;
      if (ref.current && target && !ref.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const saveTimezone = async (next: string) => {
    setTimezone(next);
    setTzBusy(true);
    try {
      await api.users.updateMe({ timezone: next });
      void queryClient.invalidateQueries({
        queryKey: dailyTimezoneKey(account.address.toLowerCase()),
      });
      setTimezoneSaved(true);
    } catch {
      api.users
        .me()
        .then(({ user }) => setTimezone(user.timezone ?? browserTimezone()))
        .catch(() => {});
    } finally {
      setTzBusy(false);
    }
  };

  const stored = identityStorage.find(account.address);

  return (
    <div className="acct" data-tour="tour-account" ref={ref}>
      <button
        className="acct-chip"
        aria-label={`Account: ${account.codename}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Identicon address={account.address} size={28} radius={9} />
        <span className="acct-name">{account.codename}</span>
        <Icon name="chevD" size={15} />
      </button>
      {open ? (
        <div ref={menuRef} className="acct-menu">
          <div className="am-head">
            <Identicon address={account.address} size={40} />
            <div>
              <div className="am-name-row">
                <div className="am-name">{account.codename}</div>
                {supporterSince ? (
                  <span className="am-chip">Since {supporterChipDate(supporterSince)}</span>
                ) : null}
              </div>
              <div className="am-addr num">{shortAddr(account.address)}</div>
            </div>
          </div>
          <div className="am-tz" data-search-id="timezone">
            <p className="am-tz-hint am-tz-hint--warn">
              Accounts inactive for over {ACCOUNT_STALE_DAYS} days may be deleted along with their
              data.
            </p>
            <label className="am-tz-label" htmlFor="acct-tz">
              Default timezone
            </label>
            <p className="am-tz-hint">
              Event times and email reminders follow this zone. Reminders are checked every 15
              minutes.
            </p>
            <TimezonePicker
              id="acct-tz"
              className="am-tz-select"
              value={timezone}
              disabled={tzBusy}
              onChange={saveTimezone}
            />
            {!timezoneSaved ? (
              <p className="am-tz-note">
                Pick your timezone so reminders fire at the right local time.
              </p>
            ) : null}
          </div>
          <div className="am-div" />
          {onWhatsNew ? (
            <button
              className="am-item"
              type="button"
              onClick={() => {
                onWhatsNew();
                setOpen(false);
              }}
            >
              <Icon name="sparkle" size={16} /> What&apos;s New
            </button>
          ) : null}
          <button
            className="am-item"
            type="button"
            onClick={() => {
              setPrefsOpen(true);
              setOpen(false);
            }}
          >
            <Icon name="bell" size={16} /> Preferences
          </button>
          <button
            className="am-item"
            type="button"
            onClick={() => {
              setNavOpen(true);
              setOpen(false);
            }}
          >
            <Icon name="list" size={16} /> Navigation
          </button>
          <button
            className="am-item"
            type="button"
            onClick={() => {
              copyText(account.address);
              setCopied(true);
              clearTimeout(copiedTimer.current);
              copiedTimer.current = setTimeout(() => setCopied(false), 1200);
            }}
          >
            <Icon name={copied ? "check" : "copy"} size={16} />{" "}
            {copied ? "Address Copied" : "Copy Address"}
          </button>
          {stored?.vault || stored?.mnemonic || sessionSecrets.get(account.address)?.mnemonic ? (
            <button
              className="am-item"
              type="button"
              onClick={() => {
                setReveal(true);
                setOpen(false);
              }}
            >
              <Icon name="key" size={16} /> Recovery Phrase
            </button>
          ) : null}
          {stored?.injected ? (
            <div className="am-item am-item--static">
              <Icon name="wallet" size={16} /> Browser Wallet
            </div>
          ) : null}
          <button
            className="am-item"
            type="button"
            onClick={() => {
              setDataOpen(true);
              setOpen(false);
            }}
          >
            <Icon name="database" size={16} /> Data &amp; Privacy
          </button>
          <button
            className="am-item"
            type="button"
            onClick={() => {
              setCsvOpen(true);
              setOpen(false);
            }}
          >
            <Icon name="download" size={16} /> Exports &amp; Imports
          </button>
          <button
            className="am-item"
            type="button"
            onClick={() => {
              setTermsOpen(true);
              setOpen(false);
            }}
          >
            <Icon name="file" size={16} /> Terms &amp; Conditions
          </button>
          <button
            className="am-item"
            type="button"
            onClick={() => {
              setCopyrightOpen(true);
              setOpen(false);
            }}
          >
            <Icon name="info" size={16} /> Copyright
          </button>
          <button
            className="am-item"
            type="button"
            onClick={() => {
              setSupportOpen(true);
              setOpen(false);
            }}
          >
            <Icon name="sparkle" size={16} /> Support Custos
          </button>
          <div className="am-div" />
          {onTakeTour ? (
            <button
              className="am-item"
              type="button"
              onClick={() => {
                onTakeTour();
                setOpen(false);
              }}
            >
              <Icon name="info" size={16} /> Take a Tour
            </button>
          ) : null}
          <button
            className="am-item danger"
            type="button"
            disabled={signingOut}
            onClick={onSignOut}
          >
            <Icon name="logout" size={16} /> {signingOut ? "Signing Out…" : "Sign Out"}
          </button>
          <div className="am-version num">v{APP_VERSION}</div>
        </div>
      ) : null}
      {reveal && stored ? (
        <RecoveryReveal identity={stored} onClose={() => setReveal(false)} />
      ) : null}
      {dataOpen ? (
        <DataPrivacyModal
          account={account}
          onClose={() => setDataOpen(false)}
          onSignedOut={onSignOut}
        />
      ) : null}
      {csvOpen ? (
        <ImportExportModal
          {...importExportProps}
          accountAddress={account.address}
          onClose={() => setCsvOpen(false)}
        />
      ) : null}
      {prefsOpen ? (
        <PreferencesModal account={account} onClose={() => setPrefsOpen(false)} />
      ) : null}
      {navOpen ? (
        <NavigationModal
          sidebarItems={navSidebarItems}
          tabItems={navTabItems}
          startView={startView}
          onSave={onSaveNavPrefs}
          onClose={() => setNavOpen(false)}
        />
      ) : null}
      {termsOpen ? <TermsModal onClose={() => setTermsOpen(false)} /> : null}
      {copyrightOpen ? <CopyrightModal onClose={() => setCopyrightOpen(false)} /> : null}
      {supportOpen ? <SupportModal onClose={() => setSupportOpen(false)} /> : null}
    </div>
  );
}
