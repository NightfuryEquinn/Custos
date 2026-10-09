import { expect, test } from "bun:test";
import { withoutFragment } from "@/frontend/lib/analytics";

test("analytics events never carry which page of the app was open", () => {
  expect(withoutFragment({ type: "pageview", url: "https://custos.example/#daily" })).toEqual({
    type: "pageview",
    url: "https://custos.example/",
  });
  expect(withoutFragment({ type: "pageview", url: "https://custos.example/" }).url).toBe(
    "https://custos.example/",
  );
});
