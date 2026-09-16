/**
 * Public funding links shown in the Support modal. Plain constants, not env
 * vars — every URL here is meant to be public.
 */

export type SupportLink = {
  label: string;
  url: string;
  kind: "tip";
};

export const SUPPORT_LINKS: SupportLink[] = [
  { label: "Ko-fi", url: "https://ko-fi.com/nightfuryequinn", kind: "tip" },
  { label: "GitHub Sponsors", url: "https://github.com/sponsors/NightfuryEquinn", kind: "tip" },
];
