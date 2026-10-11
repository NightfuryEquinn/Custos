import { decodeNudge, encodeNudge } from "@/frontend/lib/crypto/codec";
import type { Nudge } from "@/lib/nudge";
import { describe, expect, test } from "bun:test";

const key = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

const TODAY = "2026-10-11";
const base: Omit<Nudge, "id"> = {
  title: "Drink water",
  description: "Room temperature",
  target: 8,
  unit: "glasses",
  progress: { day: TODAY, count: 3 },
  enabled: true,
  everyMin: 90,
  windowStart: "08:00",
  windowEnd: "22:00",
  createdAt: "2026-10-01T00:00:00.000Z",
};

describe("nudge codec", () => {
  test("a nudge round-trips, with its timing carried beside the ciphertext", async () => {
    const k = await key();
    const body = await encodeNudge(base, k, TODAY);
    /* The server returns an absent copy and goal marker as missing fields, never null. */
    const { notifyDetails: _copy, metOn: _met, ...wire } = body;
    const back = await decodeNudge({ id: "n1", ...wire }, k);

    expect(back).toEqual({ id: "n1", ...base });
    expect(body).toMatchObject({ enabled: true, everyMin: 90, windowStart: "08:00" });
  });

  test("the count and creation time stay in the ciphertext; the readable copy is the title, goal and description", async () => {
    const body = await encodeNudge(base, await key(), TODAY);
    const { payload, ...clear } = body;

    expect(payload).not.toContain("Drink water");
    expect(JSON.stringify(clear)).not.toContain(base.createdAt);
    expect(JSON.stringify(clear)).not.toContain("count");
    expect(body.notifyDetails).toEqual({
      title: "Drink water",
      body: "8 glasses today · Room temperature",
    });
  });

  test("no readable copy leaves the device while the nudge is off", async () => {
    const body = await encodeNudge({ ...base, enabled: false }, await key(), TODAY);

    expect(body.notifyDetails).toBeNull();
  });

  test("the goal marker names today only once the count reaches the target", async () => {
    const k = await key();
    const at = (count: number, day = TODAY) =>
      encodeNudge({ ...base, progress: { day, count } }, k, TODAY);

    expect((await at(7)).metOn).toBeNull();
    expect((await at(8)).metOn).toBe(TODAY);
    expect((await at(12)).metOn).toBe(TODAY);
    // Yesterday's full count is not today's goal.
    expect((await at(8, "2026-10-10")).metOn).toBeNull();
  });

  test("no goal marker leaves the device while the nudge is off", async () => {
    const body = await encodeNudge(
      { ...base, enabled: false, progress: { day: TODAY, count: 8 } },
      await key(),
      TODAY,
    );

    expect(body.metOn).toBeNull();
  });

  test("a nudge cannot be read without the encrypted payload", async () => {
    await expect(
      decodeNudge(
        { id: "n1", enabled: true, everyMin: 30, windowStart: "08:00", windowEnd: "22:00" },
        await key(),
      ),
    ).rejects.toThrow("encrypted");
  });
});
