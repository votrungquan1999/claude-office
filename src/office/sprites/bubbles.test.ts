import { describe, expect, it } from "vitest";
import { bubbleSpriteFor } from "./spriteData";

describe("the bubble over an employee's head", () => {
  it("shows Needs permission a different picture than Waiting for you and Review", () => {
    // When we look up the picture for each kind of bubble
    const permission = bubbleSpriteFor("permission");
    const asks = bubbleSpriteFor("asks");
    const review = bubbleSpriteFor("review");

    // Then Needs permission differs from both, so the dots over Waiting for you and the "!" over a permission request never read alike
    expect(permission).not.toEqual(asks);
    expect(permission).not.toEqual(review);
    expect(asks).not.toEqual(review);
  });
});
