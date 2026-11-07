import { expect, test } from "vitest";
import { safeReturnPath } from "./sign-in-return-path";

test("a same-origin path is returned intact, so signing in again lands on the view that was interrupted", () => {
  expect(safeReturnPath("/history?range=7d")).toBe("/history?range=7d");
});

test("an off-origin destination is refused, however it is disguised", () => {
  // Each of these passes a naive "starts with a slash" check and still leaves the app.
  expect(safeReturnPath("//evil.com")).toBe("/");
  expect(safeReturnPath("/\\evil.com")).toBe("/");
  expect(safeReturnPath("https://evil.com")).toBe("/");
  expect(safeReturnPath("https:/evil.com")).toBe("/");
  expect(safeReturnPath("javascript:alert(1)")).toBe("/");
  expect(safeReturnPath("")).toBe("/");
  // A same-origin-looking value with an embedded tab/newline/CR: browsers strip ASCII tab and
  // newline anywhere in a URL before parsing it, so `window.location.href = "/\t/evil.com"`
  // actually navigates off-origin — confirmed with node's URL parser, which follows the same
  // WHATWG rule (`new URL("/\t/evil.com", "http://localhost/").origin` is "http://evil.com").
  // A check that only looks at the first two characters misses this entirely.
  expect(safeReturnPath("/\t/evil.com")).toBe("/");
  expect(safeReturnPath("/\n/evil.com")).toBe("/");
  expect(safeReturnPath("/\r/evil.com")).toBe("/");
});

test("no next parameter lands on the app root", () => {
  expect(safeReturnPath(null)).toBe("/");
});
