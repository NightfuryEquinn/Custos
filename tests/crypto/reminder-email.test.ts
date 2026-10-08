import { describe, expect, test } from "bun:test";
import { resendEmailBody } from "@/api/lib/email";
import { reminderEmailTemplate } from "@/api/lib/reminder-email-html";

describe("reminderEmailTemplate", () => {
  test("due reminder uses reminder-now and leaves optional slots empty", () => {
    const { id, subject, variables } = reminderEmailTemplate({
      title: "Upcoming event",
      when: "Mon, Jul 20 · 2:30 PM",
      category: "Appointment",
      lead: "1 day before",
    });

    expect(id).toBe("reminder-now");
    expect(subject).toBe("Upcoming: Upcoming event");
    expect(variables).toEqual({
      EVENT_TITLE: "Upcoming event",
      WHEN: "Mon, Jul 20 · 2:30 PM",
      EVENT_TYPE: "Appointment",
      LEAD: "1 day before",
      HOLD_HTML: "",
      COMMENTS_HTML: "",
    });
  });

  test("confirmation uses we-got-you-covered and a capitalized notify label", () => {
    const { id, subject, variables } = reminderEmailTemplate({
      title: "Upcoming event",
      when: "Saturday, August 8, 2026 (All day)",
      category: "Bill / Payment",
      lead: "on the day of the event (9:00 AM)",
      isConfirmation: true,
    });

    expect(id).toBe("we-got-you-covered");
    expect(subject).toBe("Reminder set: Upcoming event");
    expect(variables).toEqual({
      EVENT_TITLE: "Upcoming event",
      WHEN: "Saturday, August 8, 2026 (All day)",
      EVENT_TYPE: "Bill / Payment",
      LEAD: "on the day of the event (9:00 AM)",
      LEAD_LABEL: "On the day of the event (9:00 AM)",
      HOLD_HTML: "",
      COMMENTS_HTML: "",
    });
  });

  test("hold and comments are self-contained html only when present", () => {
    const { id, subject, variables } = reminderEmailTemplate({
      title: "Dentist",
      when: "Mon, Jul 20 · 2:30 PM",
      category: "Appointment",
      lead: "1 day before",
      hold: "RM 120 from Health",
      comments: ["Bring card", "Ask about the crown"],
    });

    expect(id).toBe("reminder-now");
    expect(subject).toBe("Upcoming: Dentist");
    expect(variables.HOLD_HTML).toContain(">Hold<");
    expect(variables.HOLD_HTML).toContain("margin-top:20px");
    expect(variables.HOLD_HTML).toContain("RM 120 from Health");
    expect(variables.COMMENTS_HTML).toContain("Comments");
    expect(variables.COMMENTS_HTML).toContain("Bring card");
    expect(variables.COMMENTS_HTML).toContain("Ask about the crown");
    expect(variables).not.toHaveProperty("LEAD_LABEL");
  });

  test("escapes user content in variables but leaves the subject as plain text", () => {
    const { subject, variables } = reminderEmailTemplate({
      title: "<script>alert(1)</script>",
      when: "Tue, Jul 21",
      category: "Personal",
      lead: "1 day before",
      hold: "<img src=x>",
      comments: ["<b>bold</b>"],
    });

    expect(subject).toBe("Upcoming: <script>alert(1)</script>");
    expect(variables.EVENT_TITLE).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(variables.HOLD_HTML).not.toContain("<img");
    expect(variables.HOLD_HTML).toContain("&lt;img src=x&gt;");
    expect(variables.COMMENTS_HTML).not.toContain("<b>");
    expect(variables.COMMENTS_HTML).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  test("blank comments leave the comments slot empty", () => {
    const { variables } = reminderEmailTemplate({
      title: "Rent",
      when: "Sat, Aug 1",
      category: "Bill / Payment",
      lead: "1 day before",
      comments: ["   "],
    });

    expect(variables.COMMENTS_HTML).toBe("");
    expect(variables.HOLD_HTML).toBe("");
  });

  test("comments html stays within Resend's 2000 character variable limit", () => {
    const comments = Array.from({ length: 20 }, () => "x".repeat(500));
    const { variables } = reminderEmailTemplate({
      title: "Rent",
      when: "Sat, Aug 1",
      category: "Bill / Payment",
      lead: "1 day before",
      comments,
    });

    const commentsHtml = variables.COMMENTS_HTML ?? "";

    expect(commentsHtml.length).toBeLessThanOrEqual(2000);
    expect(commentsHtml.length).toBeGreaterThan(0);
    expect(commentsHtml).toContain("x".repeat(500));
  });
});

describe("resendEmailBody", () => {
  test("template sends omit html, text, and attachments", () => {
    const body = resendEmailBody({
      from: "Custos <onboarding@resend.dev>",
      to: "owner@example.com",
      subject: "Upcoming: Rent",
      template: {
        id: "reminder-now",
        variables: { EVENT_TITLE: "Rent", HOLD_HTML: "", COMMENTS_HTML: "" },
      },
    });

    expect(body).toEqual({
      from: "Custos <onboarding@resend.dev>",
      to: ["owner@example.com"],
      subject: "Upcoming: Rent",
      template: {
        id: "reminder-now",
        variables: { EVENT_TITLE: "Rent", HOLD_HTML: "", COMMENTS_HTML: "" },
      },
    });
    expect(body).not.toHaveProperty("html");
    expect(body).not.toHaveProperty("text");
    expect(body).not.toHaveProperty("attachments");
  });

  test("html sends keep the logo attachment", () => {
    const body = resendEmailBody({
      from: "Custos <onboarding@resend.dev>",
      to: "owner@example.com",
      subject: "Budget alert",
      html: "<p>hi</p>",
      text: "hi",
      attachments: [
        {
          content: "abc",
          filename: "logo.png",
          content_type: "image/png",
          content_id: "custos-logo",
        },
      ],
    });

    expect(body).toMatchObject({
      html: "<p>hi</p>",
      text: "hi",
      attachments: [{ filename: "logo.png" }],
    });
    expect(body).not.toHaveProperty("template");
  });
});
