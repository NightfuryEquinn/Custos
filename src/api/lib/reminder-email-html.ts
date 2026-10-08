import { emailCommentsBlock, emailDetailRows, escapeHtml } from "@/api/lib/email-layout";

/** Resend rejects a template variable longer than this. */
const RESEND_VARIABLE_MAX = 2000;

const CONFIRMATION_TEMPLATE_ID = "we-got-you-covered";
const DUE_TEMPLATE_ID = "reminder-now";

/**
 * Upper-case the first letter so the Notify row reads as a label
 * ("On the day of the event"), while the intro keeps the same phrase mid-sentence.
 */
function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Hold card for the template slot, or empty when the event has no budget hold. */
function holdHtml(hold: string | undefined): string {
  if (!hold) return "";

  const html = emailDetailRows([{ label: "Hold", value: escapeHtml(hold) }], 20);

  return html.length <= RESEND_VARIABLE_MAX ? html : "";
}

/**
 * Comments card for the template slot.
 * Drops trailing comments until the block fits a Resend variable, since a
 * notifying event can store more text than one variable allows.
 */
function commentsHtml(comments: string[] | undefined): string {
  const items = (comments ?? []).filter((c) => c.trim());
  if (!items.length) return "";

  let kept = items;
  let html = emailCommentsBlock(kept);

  while (html.length > RESEND_VARIABLE_MAX && kept.length > 1) {
    kept = kept.slice(0, -1);
    html = emailCommentsBlock(kept);
  }

  return html.length <= RESEND_VARIABLE_MAX ? html : "";
}

export type ReminderEmailTemplate = {
  /** Published Resend template alias. */
  id: string;
  /** Plain-text subject. The API value wins over the template default. */
  subject: string;
  variables: Record<string, string>;
};

/**
 * Variables for the Resend reminder templates.
 * Confirmation is `we-got-you-covered`; a due reminder is `reminder-now`.
 * Plain fields are escaped because `{{{VAR}}}` is inserted as HTML.
 */
export function reminderEmailTemplate(opts: {
  title: string;
  when: string;
  category: string;
  lead: string;
  hold?: string;
  comments?: string[];
  isConfirmation?: boolean;
}): ReminderEmailTemplate {
  const shared = {
    EVENT_TITLE: escapeHtml(opts.title),
    WHEN: escapeHtml(opts.when),
    EVENT_TYPE: escapeHtml(opts.category),
    LEAD: escapeHtml(opts.lead),
    HOLD_HTML: holdHtml(opts.hold),
    COMMENTS_HTML: commentsHtml(opts.comments),
  };

  if (opts.isConfirmation) {
    return {
      id: CONFIRMATION_TEMPLATE_ID,
      subject: `Reminder set: ${opts.title}`,
      variables: {
        ...shared,
        LEAD_LABEL: escapeHtml(capitalizeFirst(opts.lead)),
      },
    };
  }

  return {
    id: DUE_TEMPLATE_ID,
    subject: `Upcoming: ${opts.title}`,
    variables: shared,
  };
}
