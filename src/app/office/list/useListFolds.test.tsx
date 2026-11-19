// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useListFolds } from "./useListFolds";

// Folds are remembered in localStorage, which jsdom keeps across tests in a file
beforeEach(() => window.localStorage?.clear());

const keys = (...list: string[]) => new Set(list);

interface Lists {
  listed: Set<string>;
  existing: Set<string>;
}

/** A loaded list whose Needs you the owner folded; In other companies starts folded. */
function foldedList(listed: Set<string>, existing: Set<string>) {
  const hook = renderHook(
    (props: Lists) => useListFolds(props.listed, props.existing, true),
    { initialProps: { listed, existing } as Lists },
  );
  act(() => hook.result.current.toggle("needsYou"));
  expect(hook.result.current.folds.needsYou).toBe(false);
  expect(hook.result.current.folds.otherCompanies).toBe(false);
  return hook;
}

describe("reopening Needs you for an arrival", () => {
  it("reopens it when an employee who was not waiting on the owner starts to", () => {
    const { result, rerender } = foldedList(keys("a"), keys("a"));

    rerender({ listed: keys("a", "b"), existing: keys("a", "b") });

    expect(result.current.folds.needsYou).toBe(true);
  });

  it("does not count what a changed scope adds to the list as an arrival", () => {
    // Given Needs you lists only this company; b waits in another one
    const { result, rerender } = foldedList(keys("a"), keys("a", "b"));

    // When the owner changes what Needs you lists, so b joins it
    rerender({ listed: keys("a", "b"), existing: keys("a", "b") });

    // Then Needs you stays folded
    expect(result.current.folds.needsYou).toBe(false);
  });

  it("does not count a Mac coming back online as an arrival", () => {
    // Given a waiting employee on a Mac that goes offline, which drops it from the list
    const { result, rerender } = foldedList(keys("a"), keys("a"));
    rerender({ listed: keys(), existing: keys("a") });

    // When the Mac comes back online
    rerender({ listed: keys("a"), existing: keys("a") });

    // Then Needs you stays folded
    expect(result.current.folds.needsYou).toBe(false);
  });

  it("does not count the other company's employees after a company switch as arrivals", () => {
    // Given Needs you lists only the viewed company, and b waits in the other one
    const { result, rerender } = foldedList(keys("a"), keys("a", "b"));

    // When the owner switches company
    rerender({ listed: keys("b"), existing: keys("a", "b") });

    // Then Needs you stays folded
    expect(result.current.folds.needsYou).toBe(false);
  });

  it("does not reopen it for someone who starts to wait in another company while Needs you lists only this one", () => {
    // Given Needs you lists only this company
    const { result, rerender } = foldedList(keys("a"), keys("a"));

    // When an employee of another company starts to wait on the owner
    rerender({ listed: keys("a"), existing: keys("a", "b") });

    // Then Needs you stays folded
    expect(result.current.folds.needsYou).toBe(false);
  });

  it("never reopens In other companies, which the owner opens by hand, for an arrival in another company", () => {
    // Given both sections folded, a here and x in another company
    const { result, rerender } = foldedList(keys("a"), keys("a", "x"));

    // When another company's employee y starts to wait on the owner
    rerender({
      listed: keys("a"),
      existing: keys("a", "x", "y"),
    });

    // Then both sections stay folded
    expect(result.current.folds.otherCompanies).toBe(false);
    expect(result.current.folds.needsYou).toBe(false);
  });

  it("does not reopen In other companies for an arrival in this company", () => {
    // Given both sections folded
    const { result, rerender } = foldedList(keys("a"), keys("a", "x"));

    // When an employee of this company starts to wait on the owner
    rerender({
      listed: keys("a", "b"),
      existing: keys("a", "b", "x"),
    });

    // Then only Needs you reopens
    expect(result.current.folds.needsYou).toBe(true);
    expect(result.current.folds.otherCompanies).toBe(false);
  });
});
