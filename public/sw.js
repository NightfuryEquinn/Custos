/* Versioned, complete application shell. API data stays in the encrypted IDB cache. */
const SHELL_CACHE = "custos-shell-__SW_CACHE_VERSION__";
const SHELL_ASSETS = ["__SW_ASSETS__"].filter((path) => !path.startsWith("__"));
const SHELL_URLS = ["/", "/manifest.webmanifest", ...SHELL_ASSETS];
const clientEntries = new Map();

async function pruneUnusedShells() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  // An old tab that has not identified its release still needs its cache.
  if (clients.some((client) => !clientEntries.has(client.id))) return;
  const names = (await caches.keys()).filter((name) => name.startsWith("custos-shell-"));
  const keep = new Set([SHELL_CACHE]);
  const current = await caches.open(SHELL_CACHE);
  for (const client of clients) {
    const entry = clientEntries.get(client.id);
    if (await current.match(entry)) continue;
    for (const name of names) {
      if (await (await caches.open(name)).match(entry)) {
        keep.add(name);
        break;
      }
    }
  }
  await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
  for (const id of clientEntries.keys())
    if (!clients.some((client) => client.id === id)) clientEntries.delete(id);
}

self.addEventListener("install", (event) => {
  // Install is atomic: a partial download never replaces the working release.
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Existing tabs may still use old hashed chunks; preserve their caches.
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      if (!clients.length) {
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((name) => name.startsWith("custos-shell-") && name !== SHELL_CACHE)
            .map((name) => caches.delete(name)),
        );
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
  if (event.data?.type === "CHECK_OFFLINE_READY")
    event.waitUntil(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const ready =
          SHELL_URLS.length > 2 &&
          (await Promise.all(SHELL_URLS.map((url) => cache.match(url)))).every(Boolean);
        event.ports[0]?.postMessage({ ready });
        if (
          event.source?.id &&
          typeof event.data.entry === "string" &&
          event.data.entry.startsWith("/chunk-")
        ) {
          clientEntries.set(event.source.id, event.data.entry);
          await pruneUnusedShells();
        }
      })(),
    );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api")
  )
    return;
  if (req.mode === "navigate") {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => (await cache.match("/")) || fetch(req)),
    );
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const current = await cache.match(req);
      if (current) return current;
      const immutable = url.pathname.startsWith("/chunk-") || url.pathname.startsWith("/fonts/");
      if (immutable) {
        const previous = await caches.match(req);
        if (previous) return previous;
      }
      const response = await fetch(req);
      if (response.ok && immutable) await cache.put(req, response.clone());
      return response;
    })(),
  );
});

/* ── Web Push ─────────────────────────────────────────────────────── */

const PUSH_FALLBACK = { title: "Custos", body: "You have an upcoming event.", url: "/" };

self.addEventListener("push", (event) => {
  let data = PUSH_FALLBACK;
  try {
    /* A malformed or empty payload must still surface a notification —
       userVisibleOnly subscriptions are revoked for silent pushes. */
    if (event.data) data = { ...PUSH_FALLBACK, ...event.data.json() };
  } catch {
    /* keep fallback */
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      /* No explicit icon — the browser falls back to the installed app icon. */
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.navigate
            ? client.navigate(url).then((c) => c && c.focus())
            : client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

/* Push services rotate endpoints; re-register or delivery silently stops. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription?.options?.applicationServerKey;
      if (!key) return;

      const fresh = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fresh.toJSON()),
      });
    })(),
  );
});
