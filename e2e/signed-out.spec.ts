import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test("a signed-out visitor sees only the sign-in page", async ({
  page,
  request,
}) => {
  // Given nobody is signed in, the office sends the visitor to sign in
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?next=%2F$/);
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();

  // An office API answers 401 instead of redirecting
  expect((await request.get("/api/office/changes")).status()).toBe(401);
});

test("a signed-out visit to the connect page keeps the return path", async ({
  page,
}) => {
  await page.goto("/connect?code=X");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fconnect%3Fcode%3DX$/);
});

test("a forged cookie does not get past the gate", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "forged.signature",
      url: "http://localhost:4710",
    },
  ]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("the owner's session reaches the office", async ({ context, page }) => {
  await signInAsOwner(context);
  await page.goto("/");
  await expect(page.getByTestId("office")).toBeVisible();
});

test("every page forbids being framed", async ({ context, page, request }) => {
  // Given a signed-out visitor and a signed-in owner
  const signedOut = await request.get("/sign-in");
  await signInAsOwner(context);

  // When each loads a page
  const office = await page.goto("/");

  // Then both responses forbid framing in both header forms
  for (const response of [signedOut, office]) {
    const headers = response?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
  }
});
