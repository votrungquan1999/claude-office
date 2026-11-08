import { describe, expect, it } from "vitest";
import { tagLabels } from "./tag-labels";

describe("tag labels", () => {
  it("writes a unique repo name as it is", () => {
    // Given two tags with different names, one listed twice
    const labels = tagLabels([
      { name: "api", key: "aaaaaaaaaaaa" },
      { name: "web", key: "bbbbbbbbbbbb" },
      { name: "api", key: "aaaaaaaaaaaa" },
    ]);

    // Then each reads as its name
    expect([...labels]).toEqual([
      ["aaaaaaaaaaaa", "api"],
      ["bbbbbbbbbbbb", "web"],
    ]);
  });

  it("adds the first four characters of the key to repos that share a name", () => {
    // Given two repos called api
    const labels = tagLabels([
      { name: "api", key: "1111aaaaaaaa" },
      { name: "api", key: "2222bbbbbbbb" },
    ]);

    // Then each carries its key's start
    expect(labels.get("1111aaaaaaaa")).toBe("api~1111");
    expect(labels.get("2222bbbbbbbb")).toBe("api~2222");
  });

  it("lengthens the key start until same-named repos read differently", () => {
    // Given two repos called api whose keys start alike
    const labels = tagLabels([
      { name: "api", key: "aaaabbbbcccc" },
      { name: "api", key: "aaaabbbbdddd" },
      { name: "web", key: "aaaabbbbeeee" },
    ]);

    // Then the shared names are told apart, and the lone name is untouched
    expect(labels.get("aaaabbbbcccc")).toBe("api~aaaabbbbc");
    expect(labels.get("aaaabbbbdddd")).toBe("api~aaaabbbbd");
    expect(labels.get("aaaabbbbeeee")).toBe("web");
  });

  it("writes parent/name for repos that share a name", () => {
    // Given two repos called api in different parent folders, and a lone web
    const labels = tagLabels([
      { name: "api", key: "1111aaaaaaaa", parent: "personal" },
      { name: "api", key: "2222bbbbbbbb", parent: "work" },
      { name: "web", key: "3333cccccccc", parent: "work" },
    ]);

    // Then the shared name carries its parent and the lone name is untouched
    expect(labels.get("1111aaaaaaaa")).toBe("personal/api");
    expect(labels.get("2222bbbbbbbb")).toBe("work/api");
    expect(labels.get("3333cccccccc")).toBe("web");
  });

  it("falls back to the key start for a tag without a parent or whose parent/name repeats", () => {
    // Given api tags: one stored before parents existed, two in the same parent folder name
    const labels = tagLabels([
      { name: "api", key: "1111aaaaaaaa" },
      { name: "api", key: "2222bbbbbbbb", parent: "work" },
      { name: "api", key: "3333cccccccc", parent: "work" },
    ]);

    // Then none of the three read alike
    expect(labels.get("1111aaaaaaaa")).toBe("api~1111");
    expect(labels.get("2222bbbbbbbb")).toBe("api~2222");
    expect(labels.get("3333cccccccc")).toBe("api~3333");
  });
});
