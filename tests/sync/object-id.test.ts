import { describe, expect, test } from "bun:test";
import { clientObjectId } from "@/frontend/lib/sync/object-id";
import { objectIdSchema } from "@/schemas/ids";

describe("clientObjectId", () => {
  test("matches the server's ObjectId hex shape", () => {
    const id = clientObjectId();
    expect(id).toMatch(/^[a-f0-9]{24}$/);
    expect(objectIdSchema.safeParse(id).success).toBe(true);
  });

  test("no collisions over a large sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50_000; i++) {
      seen.add(clientObjectId());
    }
    expect(seen.size).toBe(50_000);
  });
});
