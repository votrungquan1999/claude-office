import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = process.cwd();
const IMAGES = "docs/images";

/** Reads a PNG's pixel size from its IHDR chunk. */
function pngSize(file: string) {
  const bytes = readFileSync(path.join(ROOT, file));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Reads a GIF's pixel size from its logical screen descriptor. */
function gifSize(file: string) {
  const bytes = readFileSync(path.join(ROOT, file));
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

const sizeOf = (file: string) => statSync(path.join(ROOT, file)).size;
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to dashes. */
function slug(heading: string) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

/** The heading anchors a markdown text offers. */
function anchorsOf(markdown: string) {
  return new Set(
    [...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])),
  );
}

/** Every relative link and image target in a markdown file. */
function relativeTargets(markdown: string) {
  const targets: string[] = [];
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (!/^(https?:|mailto:)/.test(target)) targets.push(target);
  }
  for (const match of markdown.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
    if (!/^https?:/.test(match[1])) targets.push(match[1]);
  }
  return targets;
}

describe("the repo front page", () => {
  describe("images under docs/images", () => {
    it("holds the desktop, phone, panel, walking GIF and social preview at the sizes the README relies on", () => {
      // Given the saved captures
      const desktop = `${IMAGES}/office-desktop.png`;
      const phone = `${IMAGES}/office-phone.png`;
      const panel = `${IMAGES}/details-panel.png`;
      const gif = `${IMAGES}/office-walking.gif`;
      const social = `${IMAGES}/social-preview.png`;

      // Then each exists with the expected pixel size and weight
      for (const file of [desktop, phone, panel, gif, social]) {
        expect(existsSync(path.join(ROOT, file)), file).toBe(true);
      }
      expect(pngSize(desktop)).toEqual({ width: 1280, height: 800 });
      const phoneSize = pngSize(phone);
      expect(phoneSize.height).toBeGreaterThan(phoneSize.width);
      expect(phoneSize.width).toBeGreaterThanOrEqual(390);
      expect(pngSize(panel).width).toBeGreaterThanOrEqual(300);
      const gifDims = gifSize(gif);
      expect(gifDims.width).toBeGreaterThanOrEqual(480);
      expect(gifDims.width).toBeLessThanOrEqual(1280);
      expect(sizeOf(gif)).toBeLessThanOrEqual(5 * 1024 * 1024);
      expect(pngSize(social)).toEqual({ width: 1280, height: 640 });
      expect(sizeOf(social)).toBeLessThan(1024 * 1024);
    });
  });

  describe("README.md and CONTRIBUTING.md", () => {
    it("link only to files that exist and headings that exist", () => {
      for (const doc of ["README.md", "CONTRIBUTING.md"]) {
        const markdown = read(doc);
        const headings = anchorsOf(markdown);
        for (const target of relativeTargets(markdown)) {
          const [file, anchor] = target.split("#");
          if (file) {
            const resolved = path.join(
              path.dirname(path.join(ROOT, doc)),
              file,
            );
            expect(existsSync(resolved), `${doc} -> ${target}`).toBe(true);
            // A link into another markdown file must land on one of its headings
            if (anchor && resolved.endsWith(".md")) {
              expect(
                anchorsOf(readFileSync(resolved, "utf8")).has(anchor),
                `${doc} -> ${target}`,
              ).toBe(true);
            }
          } else {
            expect(headings.has(anchor), `${doc} -> #${anchor}`).toBe(true);
          }
        }
      }
    });

    it("show the hero image and never say v2", () => {
      const readme = read("README.md");
      expect(relativeTargets(readme)).toContain(`${IMAGES}/office-walking.gif`);
      for (const doc of [
        "README.md",
        "CONTRIBUTING.md",
        ".github/ISSUE_TEMPLATE/bug_report.yml",
        ".github/ISSUE_TEMPLATE/config.yml",
        ".github/workflows/ci.yml",
      ]) {
        expect(read(doc), doc).not.toMatch(/\bv2\b/i);
      }
    });
  });

  describe("shipped docs", () => {
    it("never name the private infra repo, its tooling or v2", () => {
      for (const doc of [
        "README.md",
        "SETUP.md",
        "CONTRIBUTING.md",
        ".env.example",
        ".github/ISSUE_TEMPLATE/bug_report.yml",
        ".github/ISSUE_TEMPLATE/config.yml",
        ".github/workflows/ci.yml",
      ]) {
        expect(read(doc), doc).not.toMatch(/personal-infra|pulumi|\bv2\b/i);
      }
    });
  });

  describe("package.json", () => {
    it("is version 0.3.1 with a typecheck script", () => {
      const pkg = JSON.parse(read("package.json"));
      expect(pkg.version).toBe("0.3.1");
      expect(pkg.scripts.typecheck).toBe("tsc --noEmit");
    });
  });

  describe("GitHub files", () => {
    it("runs lint, typecheck and unit tests on every push and pull request, and no e2e", () => {
      const ci = parse(read(".github/workflows/ci.yml"));
      const steps = Object.values<{ steps: Array<{ run?: string }> }>(
        ci.jobs,
      ).flatMap((job) => job.steps.map((step) => step.run ?? ""));
      const commands = steps.join("\n");
      expect(commands).toContain("npm run lint");
      expect(commands).toContain("npm run typecheck");
      expect(commands).toContain("npm run test:run");
      expect(commands).not.toMatch(/e2e|playwright/);
      expect(Object.keys(ci.on)).toEqual(
        expect.arrayContaining(["push", "pull_request"]),
      );
      expect(read("README.md")).toContain("actions/workflows/ci.yml/badge.svg");
      expect(ci.permissions).toEqual({ contents: "read" });
      for (const job of Object.values<{ "runs-on": string }>(ci.jobs)) {
        expect(job["runs-on"]).toBe("ubuntu-latest");
      }
    });

    it("offers a bug-report form that asks for the versions and the agent log", () => {
      const form = parse(read(".github/ISSUE_TEMPLATE/bug_report.yml"));
      const labels = form.body.map(
        (field: { attributes?: { label?: string } }) => field.attributes?.label,
      );
      expect(labels.join("\n")).toMatch(/macOS/);
      expect(labels.join("\n")).toMatch(/Node/);
      expect(labels.join("\n")).toMatch(/Claude Code/);
      expect(labels.join("\n")).toMatch(/0\.2\.0|app version/i);
      expect(labels.join("\n")).toMatch(/log/i);
      const required = form.body
        .filter(
          (field: { validations?: { required?: boolean } }) =>
            field.validations?.required,
        )
        .map((field: { id: string }) => field.id);
      expect(required).toEqual(
        expect.arrayContaining(["what", "app-version", "macos"]),
      );
      const config = parse(read(".github/ISSUE_TEMPLATE/config.yml"));
      expect(config.blank_issues_enabled).toBe(false);
    });
  });
});
