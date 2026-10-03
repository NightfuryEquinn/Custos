import { afterEach, expect, jest, test } from "bun:test";
import { closeConfirm, getFeedback, openConfirm, toast } from "@/frontend/lib/feedback";

afterEach(() => {
  jest.useRealTimers();
  closeConfirm();
});

test("toasts queue in order and expire on their own", () => {
  jest.useFakeTimers();
  toast("Transaction added");
  jest.advanceTimersByTime(1000);
  toast("Event deleted");
  expect(getFeedback().toasts.map((t) => t.message)).toEqual([
    "Transaction added",
    "Event deleted",
  ]);

  jest.advanceTimersByTime(2300);
  expect(getFeedback().toasts.map((t) => t.message)).toEqual(["Event deleted"]);

  jest.advanceTimersByTime(1000);
  expect(getFeedback().toasts).toEqual([]);
});

test("openConfirm holds one request until it is closed", () => {
  openConfirm({ title: "Delete Wallet", message: "Sure?", onConfirm: () => {} });
  expect(getFeedback().confirm?.title).toBe("Delete Wallet");

  closeConfirm();
  expect(getFeedback().confirm).toBeNull();
});
