import { budgetAlertEmailHtml, resendEmailBody } from "@/api/lib/email";
import { mock } from "bun:test";

type SendEmailResult = { ok: true; id: string } | { ok: false; error: string };

type EmailMockOverrides = {
  emailConfigured?: () => boolean;
  sendEmail?: (input: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    template?: {
      id: string;
      variables: Record<string, string>;
    };
  }) => Promise<SendEmailResult>;
};

/** Mock outbound email while keeping real HTML and Resend body builders. */
export function installEmailMock(overrides: EmailMockOverrides = {}) {
  mock.module("@/api/lib/email", () => ({
    emailConfigured: overrides.emailConfigured ?? (() => false),
    sendEmail: overrides.sendEmail ?? (async () => ({ ok: true, id: "test" })),
    budgetAlertEmailHtml,
    resendEmailBody,
  }));
}
