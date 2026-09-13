/**
 * Public funding links shown in the Support modal. Plain constants, not env
 * vars — every URL here is meant to be public.
 *
 * Placeholder URLs below — swap in the real Ko-fi / GitHub Sponsors / Lemon
 * Squeezy accounts before this ships. The Lifetime checkout must collect the
 * buyer's wallet address as a required custom field — that address is what
 * `scripts/grant-supporter.ts` looks up.
 */

export type SupportLink = {
  label: string;
  url: string;
  kind: "tip" | "lifetime";
};

export const SUPPORT_LINKS: SupportLink[] = [
  { label: "Ko-fi", url: "https://ko-fi.com/nightfuryequinn", kind: "tip" },
  { label: "GitHub Sponsors", url: "https://github.com/sponsors/NightfuryEquinn", kind: "tip" },
  {
    label: "Lemon Squeezy",
    url: "https://custos-nightfuryequinn.lemonsqueezy.com/checkout",
    kind: "lifetime",
  },
];
