import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

type WorkerEvent = {
  request?: Request;
  data?: { type: string; entry?: string };
  source?: { id: string };
  ports?: Array<{ postMessage: (message: { ready: boolean }) => void }>;
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith?: (promise: Promise<Response>) => void;
};

function worker(failDownload = false, openTabs = 1) {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const stored = new Map<string, Response>();
  const deleted: string[] = [];
  let activations = 0;
  const cache = {
    addAll: async (urls: string[]) => {
      if (failDownload) throw new Error("Interrupted download");
      for (const url of urls) stored.set(url, new Response(url === "/" ? "new shell" : url));
    },
    match: async (url: string | Request) =>
      stored.get(typeof url === "string" ? url : new URL(url.url).pathname),
    put: async () => {},
  };
  const source = readFileSync("public/sw.js", "utf8")
    .replaceAll("__SW_CACHE_VERSION__", "test-release")
    .replace('"__SW_ASSETS__"', '"/chunk-unvisited.js", "/fonts/test.woff2"');
  runInNewContext(source, {
    self: {
      location: { origin: "http://localhost" },
      addEventListener: (name: string, listener: (event: WorkerEvent) => void) =>
        handlers.set(name, listener),
      skipWaiting: async () => {
        activations++;
      },
      clients: {
        matchAll: async () => Array.from({ length: openTabs }, (_, i) => ({ id: `tab-${i}` })),
        claim: async () => {},
      },
    },
    caches: {
      open: async () => cache,
      keys: async () => ["custos-shell-previous", "custos-shell-test-release", "unrelated"],
      delete: async (name: string) => {
        deleted.push(name);
      },
      match: cache.match,
    },
    URL,
    fetch: async () => new Response("network"),
  });
  async function fire(name: string, data: Partial<WorkerEvent> = {}) {
    let work: Promise<unknown> = Promise.resolve();
    handlers.get(name)!({
      waitUntil: (promise) => {
        work = promise;
      },
      ...data,
    });
    await work;
  }
  return { fire, handlers, stored, deleted, activations: () => activations };
}

describe("complete offline shell", () => {
  test("caches unvisited chunks and fonts without forcing activation", async () => {
    const sw = worker();
    await sw.fire("install");
    expect(sw.stored.has("/chunk-unvisited.js")).toBe(true);
    expect(sw.stored.has("/fonts/test.woff2")).toBe(true);
    expect(sw.activations()).toBe(0);
    let ready = false;
    await sw.fire("message", {
      data: { type: "CHECK_OFFLINE_READY" },
      ports: [
        {
          postMessage: (message) => {
            ready = message.ready;
          },
        },
      ],
    });
    expect(ready).toBe(true);
    sw.stored.delete("/chunk-unvisited.js");
    await sw.fire("message", {
      data: { type: "CHECK_OFFLINE_READY" },
      ports: [
        {
          postMessage: (message) => {
            ready = message.ready;
          },
        },
      ],
    });
    expect(ready).toBe(false);
  });
  test("a failed install does not activate a partial replacement", async () => {
    const sw = worker(true);
    await expect(sw.fire("install")).rejects.toThrow("Interrupted download");
    expect(sw.activations()).toBe(0);
  });
  test("preserves old assets for open tabs, and only removes owned caches when safe", async () => {
    const open = worker();
    await open.fire("activate");
    expect(open.deleted).toEqual([]);
    const closed = worker(false, 0);
    await closed.fire("activate");
    expect(closed.deleted).toEqual(["custos-shell-previous"]);
  });
  test("activation requires the explicit update action", async () => {
    const sw = worker();
    await sw.fire("message", { data: { type: "ACTIVATE_UPDATE" } });
    expect(sw.activations()).toBe(1);
  });
  test("prunes obsolete releases only after every open tab identifies its assets", async () => {
    const known = worker();
    await known.fire("install");
    await known.fire("message", {
      source: { id: "tab-0" },
      data: { type: "CHECK_OFFLINE_READY", entry: "/chunk-unvisited.js" },
      ports: [],
    });
    expect(known.deleted).toEqual(["custos-shell-previous"]);
    const unknown = worker(false, 2);
    await unknown.fire("install");
    await unknown.fire("message", {
      source: { id: "tab-0" },
      data: { type: "CHECK_OFFLINE_READY", entry: "/chunk-unvisited.js" },
      ports: [],
    });
    expect(unknown.deleted).toEqual([]);
  });
  test("serves a coherent cached navigation shell and leaves API reads alone", async () => {
    const sw = worker();
    await sw.fire("install");
    let response: Promise<Response> | undefined;
    sw.handlers.get("fetch")!({
      request: { method: "GET", url: "http://localhost/", mode: "navigate" } as Request,
      waitUntil: () => {},
      respondWith: (promise) => {
        response = promise;
      },
    });
    expect(await (await response!)!.text()).toBe("new shell");
    let intercepted = false;
    sw.handlers.get("fetch")!({
      request: new Request("http://localhost/api/expenses"),
      waitUntil: () => {},
      respondWith: () => {
        intercepted = true;
      },
    });
    expect(intercepted).toBe(false);
  });
});
