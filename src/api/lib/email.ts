import { escapeHtml, LOGO_CONTENT_ID, wrapEmailBody } from "@/api/lib/email-layout";

/** Injected by build.ts into the Vercel API bundle; unset in local/dev. */
declare const __EMAIL_LOGO_BASE64__: string | undefined;

type HtmlEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

type TemplateEmailInput = {
  to: string;
  subject: string;
  template: {
    id: string;
    variables: Record<string, string>;
  };
};

type SendEmailInput = HtmlEmailInput | TemplateEmailInput;

type LogoAttachment = {
  content: string;
  filename: string;
  content_type: string;
  content_id: string;
};

type ResendBodyInput = {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: LogoAttachment[];
  template?: TemplateEmailInput["template"];
};

/**
 * JSON body for one Resend send.
 * A template send cannot also include html, text, or attachments.
 */
export function resendEmailBody(input: ResendBodyInput): Record<string, unknown> {
  if (input.template) {
    return {
      from: input.from,
      to: [input.to],
      subject: input.subject,
      template: input.template,
    };
  }

  return {
    from: input.from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments,
  };
}

let logoBase64: string | undefined;

/** Whether Resend is configured via RESEND_API_KEY. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/**
 * Resolve logo base64 for CID attachments.
 * Production embeds bytes via Bun.build define (no sidecar file on Vercel).
 * Local/dev reads the source PNG from disk.
 */
async function loadLogoBase64(): Promise<string> {
  const embedded = typeof __EMAIL_LOGO_BASE64__ === "string" ? __EMAIL_LOGO_BASE64__ : "";

  if (embedded) {
    return embedded;
  }

  const file = Bun.file(new URL("../../frontend/assets/logo.png", import.meta.url));
  const bytes = await file.arrayBuffer();

  return Buffer.from(bytes).toString("base64");
}

/** Load the brand logo as base64 for Resend inline (CID) attachments. */
async function getLogoAttachment(): Promise<LogoAttachment> {
  if (!logoBase64) {
    logoBase64 = await loadLogoBase64();
  }

  return {
    content: logoBase64,
    filename: "logo.png",
    content_type: "image/png",
    content_id: LOGO_CONTENT_ID,
  };
}

/**
 * Send a transactional email via Resend.
 * HTML sends embed the Custos logo. Template sends leave the logo to the template.
 */
export async function sendEmail(
  input: SendEmailInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping send");

    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const from = process.env.EMAIL_FROM?.trim() || "Custos <onboarding@resend.dev>";
  const body =
    "template" in input
      ? resendEmailBody({
          from,
          to: input.to,
          subject: input.subject,
          template: input.template,
        })
      : resendEmailBody({
          from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
          attachments: [await getLogoAttachment()],
        });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await res.json().catch(() => ({}))) as { id?: string; message?: string };

  if (!res.ok) {
    const error = payload.message ?? `Resend HTTP ${res.status}`;
    console.error("[email] send failed:", error);

    return { ok: false, error };
  }

  return { ok: true, id: payload.id ?? "unknown" };
}

/** Build budget warning / exceeded email subject, HTML, and plain text. */
export function budgetAlertEmailHtml(opts: {
  categoryName: string;
  level: "warning" | "exceeded";
  spentLabel: string;
  budgetLabel: string;
  percent: number;
  monthLabel: string;
  walletName?: string;
}): { html: string; text: string; subject: string } {
  const near = opts.level === "warning";
  const subject = near
    ? `Budget alert: ${opts.categoryName} is ${opts.percent}% used`
    : `Budget exceeded: ${opts.categoryName}`;

  const intro = near
    ? `Your <strong>${escapeHtml(opts.categoryName)}</strong> budget is nearing its limit for ${escapeHtml(opts.monthLabel)}.`
    : `Your <strong>${escapeHtml(opts.categoryName)}</strong> budget has been exceeded for ${escapeHtml(opts.monthLabel)}.`;

  const detailRows = [
    { label: "Category", value: escapeHtml(opts.categoryName), strong: true },
    { label: "Spent", value: escapeHtml(opts.spentLabel) },
    { label: "Budget", value: escapeHtml(opts.budgetLabel) },
    { label: "Used", value: `${opts.percent}%` },
    ...(opts.walletName ? [{ label: "Wallet", value: escapeHtml(opts.walletName) }] : []),
  ];

  const html = wrapEmailBody({
    heading: near ? "Nearing budget limit" : "Budget exceeded",
    introHtml: intro,
    detailRows,
  });

  const text = near
    ? `Budget alert: ${opts.categoryName} is ${opts.percent}% used (${opts.spentLabel} of ${opts.budgetLabel}) for ${opts.monthLabel}.`
    : `Budget exceeded: ${opts.categoryName} — ${opts.spentLabel} of ${opts.budgetLabel} for ${opts.monthLabel}.`;

  return { html, text, subject };
}
