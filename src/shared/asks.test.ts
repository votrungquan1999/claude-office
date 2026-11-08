import { describe, expect, it } from "vitest";
import { asks } from "./asks";

describe("the rule for a turn that asked the owner something", () => {
  it("says yes for a closing question or an invitation to reply, and no for a plain statement", () => {
    // Given last answers that ask, and last answers that do not
    const asking = [
      "I fixed it. Want me to push?",
      "Done.\n\nWhich branch should I use?",
      "Tell me which one you prefer.",
      "Everything is updated. Let me know if it looks right.",
      "The change is in. Say the word and I will merge it.",
      "I can do either. Do you want the short form or the long one",
      "Two options. Should I start with the first?\n\n*(No rush.)*",
      "Fixed.\nNo spec update is needed.\nShall I continue?",
    ];
    const plain = [
      "No spec update is needed.",
      "Nothing to update in the spec yet.",
      "The build passed, which is why the deploy ran.",
      "which is why the build failed",
      "I checked whether I should have changed it, and no change was needed.",
      "Pushed the branch and opened the pull request.",
      "```js\nconst a = b ? 1 : 2;\nwhat?\n```\nAll done.",
      "the config decides which of the two files wins",
      "it depends on how you tell me nothing",
      "",
    ];

    // When the rule reads each
    const asked = asking.map((text) => asks(text));
    const notAsked = plain.map((text) => asks(text));

    // Then the first group is all yes, the second all no, and a missing text is no
    expect(asked).toEqual(asking.map(() => true));
    expect(notAsked).toEqual(plain.map(() => false));
    expect(asks(undefined)).toBe(false);
  });

  it("looks only at the last three lines of prose", () => {
    // Given a question far above a long plain ending
    const text = "Should I continue?\n\nStep one.\nStep two.\nStep three.";

    // Then it is not seen
    expect(asks(text)).toBe(false);
  });
});
