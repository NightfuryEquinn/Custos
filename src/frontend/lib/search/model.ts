import type { ViewId } from "@/lib/views";

export type SearchKind =
  | "page"
  | "setting"
  | "wallet"
  | "expense"
  | "event"
  | "category"
  | "budget"
  | "todo"
  | "daily"
  | "nudge"
  | "capital"
  | "vehicle"
  | "fill";
export type SearchTarget = {
  kind: SearchKind;
  view: ViewId;
  id: string;
  parentId?: string;
  walletId?: string;
  date?: string;
};
export type SearchDocument = {
  key: string;
  title: string;
  context: string;
  text: string;
  group: string;
  target: SearchTarget;
};

/** Normalize words, accents, and formatted amounts without changing source text. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prepare text once, instead of normalizing thousands of records on each keystroke. */
export function indexDocuments(documents: SearchDocument[]) {
  return documents.map((document) => ({
    document,
    title: normalizeSearch(document.title),
    text: normalizeSearch(`${document.title} ${document.context} ${document.text}`),
  }));
}

/** Rank all matching records deterministically; presentation pagination never limits coverage. */
export function searchIndex(index: ReturnType<typeof indexDocuments>, query: string, group = "") {
  const normalized = normalizeSearch(query);
  const words = normalized.split(" ").filter(Boolean);
  return index
    .filter(
      ({ document, text }) =>
        (!group || document.group === group) &&
        (words.length
          ? words.every((word) => text.includes(word))
          : ["page", "setting"].includes(document.target.kind)),
    )
    .map(({ document, title }) => ({
      document,
      rank:
        title === normalized
          ? 0
          : title.startsWith(normalized)
            ? 1
            : words.every((word) => title.includes(word))
              ? 2
              : 3,
    }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (b.document.target.date ?? "").localeCompare(a.document.target.date ?? "") ||
        a.document.key.localeCompare(b.document.key),
    )
    .map(({ document }) => document.key);
}

/** Merge downloaded records with live edits; pending deletes are applied by the overlay afterward. */
export function mergeRecords<T extends { id: string }>(downloaded: T[], live: T[]): T[] {
  return [...new Map([...downloaded, ...live].map((row) => [row.id, row])).values()];
}
