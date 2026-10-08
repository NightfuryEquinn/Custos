export const LOGO_CONTENT_ID = "custos-logo";

type DetailRow = {
  label: string;
  value: string;
  strong?: boolean;
};

/** Escape text for safe inclusion in HTML email bodies. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Brand mark markup shared by all transactional email templates. */
export function emailLogoHtml(): string {
  return `<img src="cid:${LOGO_CONTENT_ID}" alt="Custos" width="96" height="96" style="display:block;width:96px;height:96px;margin:0 0 28px;border:0" />`;
}

/** Render label/value rows inside a card-style table block. */
export function emailDetailRows(rows: DetailRow[], marginTop = 0): string {
  const inner = rows
    .map((row, index) => {
      const isLast = index === rows.length - 1;
      const border = isLast ? "" : "border-bottom:1px solid #e8e4df;";
      const value = row.strong ? `<strong>${row.value}</strong>` : row.value;

      return `<tr>
      <td style="padding:12px 0;${border}width:32%;font-size:12px;letter-spacing:0.04em;color:#5b6472;vertical-align:top">${escapeHtml(row.label)}</td>
      <td style="padding:12px 0;${border}font-size:15px;color:#20242b">${value}</td>
    </tr>`;
    })
    .join("\n    ");

  const margin = marginTop > 0 ? `margin-top:${marginTop}px;` : "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="${margin}width:100%;border-collapse:collapse;background:#f7f5f2;border:1px solid #e8e4df;border-radius:12px">
  <tr>
    <td style="padding:20px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
    ${inner}
      </table>
    </td>
  </tr>
</table>`;
}

/** Render an optional comments card when the caller supplies non-blank items. */
export function emailCommentsBlock(comments: string[]): string {
  const items = comments.filter((c) => c.trim());
  if (!items.length) return "";

  const list = items
    .map((c) => `<li style="margin:0 0 10px">${escapeHtml(c)}</li>`)
    .join("\n        ");

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:20px;background:#f7f5f2;border:1px solid #e8e4df;border-radius:12px">
  <tr>
    <td style="padding:20px">
      <h3 style="margin:0 0 12px;font-size:12px;letter-spacing:0.04em;color:#5b6472;text-transform:uppercase">Comments</h3>
      <ul style="margin:0;padding:0 0 0 18px;font-size:15px;color:#20242b">
        ${list}
      </ul>
    </td>
  </tr>
</table>`;
}

/** Assemble a full HTML email body with shared spacing and typography. */
export function wrapEmailBody(opts: {
  heading: string;
  introHtml: string;
  detailRows: DetailRow[];
  comments?: string[];
  footer?: string;
}): string {
  const commentsHtml = opts.comments?.length ? emailCommentsBlock(opts.comments) : "";
  const footer = opts.footer ?? "— Custos";

  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#20242b;max-width:520px;margin:0 auto;padding:32px">
  ${emailLogoHtml()}
  <h2 style="margin:0 0 16px;font-size:20px;color:#20242b">${opts.heading}</h2>
  <p style="margin:0 0 24px;color:#5b6472">${opts.introHtml}</p>
  ${emailDetailRows(opts.detailRows)}
  ${commentsHtml}
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e8e4df;font-size:13px;color:#8b93a1">${footer}</p>
</body>
</html>`;
}
