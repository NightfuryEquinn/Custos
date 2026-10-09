/**
 * The open page of the app is the URL fragment (#daily, #budgets). Analytics gets the
 * address without it, so it can never learn which part of Custos someone is using.
 */
export function withoutFragment<T extends { url: string }>(event: T): T {
  const at = event.url.indexOf("#");

  return at < 0 ? event : { ...event, url: event.url.slice(0, at) };
}
