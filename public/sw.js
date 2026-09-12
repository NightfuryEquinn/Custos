/* Custos service worker — app shell cache only (read path). */
const SHELL_CACHE = "custos-shell-v1";
const SHELL_URLS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  /* Never intercept API — IndexedDB cipher cache handles offline reads in the page. */
  if (url.pathname.startsWith("/api")) return;
  /* Leave third-party requests alone (analytics, etc.). */
  if (url.origin !== self.location.origin) return;

  /* Content-hashed bundler output and self-hosted fonts never change under
     a given filename (vercel.json also sends them as immutable) — serve
     straight from cache with no network round trip, instead of the
     network-first strategy below that's right for everything else. */
  const isImmutableAsset = url.pathname.startsWith("/chunk-") || url.pathname.startsWith("/fonts/");
  if (isImmutableAsset) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) void caches.open(SHELL_CACHE).then((cache) => cache.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        if (
          res.ok &&
          (url.pathname === "/" ||
            url.pathname.endsWith(".js") ||
            url.pathname.endsWith(".css") ||
            url.pathname.endsWith(".woff2"))
        ) {
          void caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        throw new Error("offline");
      }),
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
