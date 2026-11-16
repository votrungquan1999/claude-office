import { expect, test } from "@playwright/test";

interface ManifestIcon {
  src: string;
  sizes: string;
  purpose?: string;
}

test("a signed-out phone gets the icons and app manifest it needs to add the office to the home screen", async ({
  page,
  request,
}) => {
  // Given nobody is signed in, the sign-in page links the manifest and the icons
  await page.goto("/sign-in");
  const head = page.locator("head");
  const manifestHref = await head
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  const appleIconHref = await head
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute("href");
  await expect(head.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#1e1e2e",
  );

  // When the phone fetches the manifest without a session cookie
  const manifestResponse = await request.get(manifestHref ?? "", {
    maxRedirects: 0,
  });

  // Then it gets the manifest itself, not a redirect to sign-in
  expect(manifestResponse.status()).toBe(200);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    name: "Claude Office",
    start_url: "/",
    display: "standalone",
  });
  const icons: ManifestIcon[] = manifest.icons;
  expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);

  // And every icon it names, the favicon and the Apple icon load as images
  for (const src of [
    ...icons.map((icon) => icon.src),
    appleIconHref ?? "",
    "/favicon.ico",
  ]) {
    const icon = await request.get(src, { maxRedirects: 0 });
    expect(icon.status(), src).toBe(200);
    expect(icon.headers()["content-type"], src).toMatch(/^image\//);
  }
});

test("search engines are told to stay out of the office", async ({
  page,
  request,
}) => {
  const robots = await request.get("/robots.txt", { maxRedirects: 0 });
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/Disallow: \/\s*$/m);

  await page.goto("/sign-in");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});
