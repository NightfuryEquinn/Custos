import { indexDocuments, searchIndex, type SearchDocument } from "./model";

let index: ReturnType<typeof indexDocuments> = [];
/** Keep indexing and matching off the rendering thread; replies carry only result identifiers. */
globalThis.onmessage = (
  event: MessageEvent<{
    documents?: SearchDocument[];
    query: string;
    group: string;
    sequence: number;
  }>,
) => {
  const { documents, query, group, sequence } = event.data;
  if (documents) index = indexDocuments(documents);
  globalThis.postMessage({ sequence, keys: searchIndex(index, query, group) });
};
