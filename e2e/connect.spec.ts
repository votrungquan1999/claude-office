import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test("the owner sees the Mac's name and code, one click connects it, and the Mac collects once", async ({
  context,
  page,
  request,
}) => {
  // Given a Mac that asked to connect
  const created = await (
    await request.post("/api/connect", {
      data: { hostname: "Quan's MacBook" },
    })
  ).json();

  // When the signed-in owner opens the link from the terminal
  await signInAsOwner(context);
  await page.goto(
    new URL(created.connectUrl).pathname + new URL(created.connectUrl).search,
  );

  // Then the page names the Mac and shows the code to compare with the terminal
  await expect(page.getByTestId("connect-hostname")).toHaveText(
    "Quan's MacBook",
  );
  await expect(page.getByTestId("connect-code")).toHaveText(
    `${created.userCode.slice(0, 4)}-${created.userCode.slice(4)}`,
  );
  const pollBefore = await request.post("/api/connect/collect", {
    data: { pollSecret: created.pollSecret },
  });
  expect(pollBefore.status()).toBe(202);

  // And one click approves it
  await page.getByRole("button", { name: "Connect this Mac" }).click();
  await expect(page.getByRole("status")).toContainText("Connected");
  const pollAfter = await request.post("/api/connect/collect", {
    data: { pollSecret: created.pollSecret },
  });
  expect(pollAfter.status()).toBe(200);
});

test("an unknown code shows a message instead of the button", async ({
  context,
  page,
}) => {
  await signInAsOwner(context);
  await page.goto("/connect?code=ZZZZZZZZ");
  await expect(
    page.getByText("This code is unknown or has expired"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect this Mac" }),
  ).toHaveCount(0);
});
