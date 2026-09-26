import { ACCOUNT_STALE_DAYS } from "@/lib/account-retention";
import { SHARING_LEGAL_PARAGRAPH, TERMS_UPDATED } from "@/lib/legal";
import { Icon } from "@/frontend/components/ui";
import { useModalMotion } from "@/frontend/lib/animate";
import { useRef } from "react";
import { createPortal } from "react-dom";

type LegalModalProps = {
  onClose: () => void;
};

/** Terms & Conditions modal for account menu legal links. */
export function TermsModal({ onClose }: LegalModalProps) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose(onClose);
      }}
    >
      <div
        ref={panelRef}
        className="modal sm modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tnc-title"
      >
        <div className="modal-head">
          <h3 id="tnc-title">Terms &amp; Conditions</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={() => requestClose(onClose)}
            aria-label="Close"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body modal-scroll">
          <p className="dm-lead">
            Last updated {TERMS_UPDATED}. By using Custos you agree to these terms.
          </p>

          <div className="dm-sec">
            <span className="fld-label">Service</span>
            <p className="legal-p">
              Custos is a private expense ledger and schedule app. You sign in with a Web3 wallet
              identity. We do not require an email or password. You are responsible for safeguarding
              your wallet keys and recovery phrase. Prefer creating a ledger-only identity in the
              app rather than reconnecting a funded exchange or hot wallet, so the login address is
              less likely to be correlated with on-chain activity.
            </p>
          </div>

          <div className="dm-div" />

          <div className="dm-sec">
            <span className="fld-label">Hosted service</span>
            <p className="legal-p">
              The public may use the Licensor&apos;s official hosted app free of charge with full
              features. That free path applies only to the official host. Self-hosting, rebranding,
              claiming Custos as your product, or offering a competing product or hosted service
              requires a written commercial agreement with the Licensor (monthly fee, collaboration,
              or copyright buyout). Contact{" "}
              <a href="mailto:xianzyip8@gmail.com">xianzyip8@gmail.com</a>.
            </p>
          </div>

          <div className="dm-div" />

          <div className="dm-sec">
            <span className="fld-label">Your data</span>
            <p className="legal-p">
              Ledger data you create (transactions, budgets, events, categories, and related
              preferences) is stored with your account. You can export a CSV copy and manage
              sessions, reminder preferences, and third-party sharing from Data &amp; privacy.
              Clearing local browser data does not delete your server-side ledger. Accounts inactive
              for over {ACCOUNT_STALE_DAYS} days may be deleted along with their associated data.
            </p>
          </div>

          <div className="dm-div" />

          <div className="dm-sec">
            <span className="fld-label">Freemium &amp; data sharing</span>
            <p className="legal-p">{SHARING_LEGAL_PARAGRAPH}</p>
          </div>

          <div className="dm-div" />

          <div className="dm-sec">
            <span className="fld-label">Acceptable use</span>
            <p className="legal-p">
              Use the service only for lawful expense tracking and scheduling. Do not attempt to
              disrupt the service, circumvent security controls, or access another person&apos;s
              account.
            </p>
          </div>

          <div className="dm-div" />

          <div className="dm-sec">
            <span className="fld-label">Software license</span>
            <p className="legal-p">
              The Custos source code is proprietary (Custos Proprietary License). The repository is
              public for transparency and evaluation. Using this hosted service does not grant you
              rights to copy, modify, redistribute, self-host, rebrand, or offer Custos as a
              competing commercial product or hosted service except under a separate written
              commercial agreement with the Licensor. See the project LICENSE file and Copyright
              notice.
            </p>
          </div>

          <div className="dm-div" />

          <div className="dm-sec">
            <span className="fld-label">Availability &amp; disclaimer</span>
            <p className="legal-p">
              The service is provided as-is. We may change or discontinue features. Custos is not
              financial, tax, or legal advice. Reminder emails may be delayed or skipped depending
              on your settings and scheduling infrastructure.
            </p>
          </div>

          <div className="dm-div" />

          <div className="dm-sec">
            <span className="fld-label">Changes</span>
            <p className="legal-p">
              We may update these terms from time to time. Continued use after an update means you
              accept the revised terms. Questions about these terms:{" "}
              <a href="mailto:xianzyip8@gmail.com">xianzyip8@gmail.com</a> or the project
              repository.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Copyright and project license modal for account menu legal links. */
export function CopyrightModal({ onClose }: LegalModalProps) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose(onClose);
      }}
    >
      <div
        ref={panelRef}
        className="modal sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="copyright-title"
      >
        <div className="modal-head">
          <h3 id="copyright-title">Copyright</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={() => requestClose(onClose)}
            aria-label="Close"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body modal-scroll">
          <div className="dm-sec">
            <p className="legal-p legal-p--lead">
              © 2026 Yip Zi Xian / Custos. All rights reserved except where a written agreement
              grants otherwise.
            </p>
            <p className="legal-p">
              Custos and its accompanying materials are licensed under the Custos Proprietary
              License. The source repository is public for transparency and private evaluation. You
              may use the Licensor&apos;s official hosted app free of charge with full features
              under the Terms &amp; Conditions.
            </p>
            <p className="legal-p">
              You may not claim Custos as your product, self-host it, redistribute it for others to
              use, or offer it as a competing product or hosted service without a written commercial
              agreement (monthly fee, collaboration, or copyright buyout). Contact{" "}
              <a href="mailto:xianzyip8@gmail.com">xianzyip8@gmail.com</a>.
            </p>
            <p className="legal-p">The software is provided as-is, without warranty of any kind.</p>
            <p className="dm-note">
              The full license text is available in the project <span className="num">LICENSE</span>{" "}
              file.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
