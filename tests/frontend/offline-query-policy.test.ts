import { afterEach, beforeEach, expect, test } from "bun:test";
import { MutationObserver, onlineManager } from "@tanstack/react-query";
import { createLedgerQueryClient } from "@/frontend/lib/query-client";
import { putCipherCache, getCipherCache } from "@/frontend/lib/pwa/cipher-cache";
import { enqueueOutbox, listOutbox } from "@/frontend/lib/sync/outbox";
import { encodeTodoListCreate } from "@/frontend/lib/crypto/codec";
import { resetFakeIdb } from "../helpers/fake-idb";
import { entry, TEST_ADDRESS } from "../helpers/outbox";

beforeEach(() => {
  resetFakeIdb();
  onlineManager.setOnline(false);
});
afterEach(() => onlineManager.setOnline(true));

test("production query policy executes cached reads while offline", async () => {
  const client = createLedgerQueryClient();
  await putCipherCache(TEST_ADDRESS, "/wallets", { wallets: [] });
  try {
    const result = await client.fetchQuery({
      queryKey: ["offline-wallets"],
      queryFn: () => getCipherCache(TEST_ADDRESS, "/wallets"),
    });
    expect(result).toEqual({ wallets: [] });
  } finally {
    client.clear();
  }
}, 2000);

test("production mutation policy durably saves encrypted tasks while offline", async () => {
  const client = createLedgerQueryClient();
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const body = await encodeTodoListCreate(
    { name: "Everyday", icon: "📋", tasks: [{ id: "task-1", title: "Book tickets", done: false }] },
    key,
  );
  const observer = new MutationObserver(client, {
    mutationFn: () =>
      enqueueOutbox(
        entry({ entity: "todoList", request: { method: "POST", path: "/todo-lists", body } }),
      ),
  });
  try {
    await observer.mutate();
    const saved = await listOutbox(TEST_ADDRESS);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe("pending");
    expect(JSON.stringify(saved[0]!.request.body)).not.toContain("Book tickets");
  } finally {
    client.clear();
  }
}, 2000);

test("a failed query logs the error's kind, never text that could have been decrypted", () => {
  const client = createLedgerQueryClient();
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    client
      .getQueryCache()
      .config.onError?.(new SyntaxError("Unexpected token in: Take medication"), {
        queryHash: "h",
      } as never);
  } finally {
    console.error = original;
  }

  expect(JSON.stringify(logged)).not.toContain("Take medication");
  expect(JSON.stringify(logged)).toContain("SyntaxError");
});
