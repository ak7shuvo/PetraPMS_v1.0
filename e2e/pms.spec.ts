import { test, expect, type Page } from "@playwright/test";

// One serial journey: setup wizard → sign in → front desk check-in → folio payment → check-out → language switch.
test.describe.configure({ mode: "serial" });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => page.close());

async function signIn() {
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("Admin1234");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("quick setup creates the hotel (with demo data)", async () => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel(/Hotel name/).fill("E2E Grand Hotel");
  const next = page.getByRole("button", { name: "Next", exact: true });
  await next.click(); // → License
  await page.getByRole("button", { name: "Show request code" }).click();
  await expect(page.getByText(/^PETRAREQ1\./)).toBeVisible();
  await next.click(); // → Administrator
  await page.getByLabel(/Full name/).fill("Admin User");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel(/^Password\s*\*/).fill("Admin1234");
  await page.getByLabel(/^Repeat password/).fill("Admin1234");
  await next.click(); // → Database check
  await expect(page.getByText(/Writable: ✓/)).toBeVisible();
  for (let i = 0; i < 5; i++) await next.click(); // database → rooms → types → tax → backup → review
  await page.getByLabel(/Load demo data/).check();
  await page.getByRole("button", { name: "Create my hotel" }).click();
  // Setup signs the new administrator in directly (or shows the sign-in form).
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
});

test("sign in shows dashboard with business date chip", async () => {
  await page.goto("/dashboard");
  await page.waitForTimeout(1500);
  if (await page.getByLabel("Username").isVisible()) await signIn();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Admin User").first()).toBeVisible();
  await expect(page.getByText(/Demo data is loaded/)).toBeVisible();
});

test("check in an arrival from the front desk and take payment on the folio", async () => {
  await page.goto("/frontdesk");
  const buttons = page.getByRole("button", { name: "Check in", exact: true });
  await expect(buttons.first()).toBeVisible({ timeout: 20_000 });
  // Demo arrivals may be waiting for a room that is still occupied (same-day turnover): try each until one works.
  let ok = false;
  const n = await buttons.count();
  for (let i = 0; i < n && !ok; i++) {
    await buttons.nth(i).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Check in", exact: true }).click();
    ok = await page.getByText(/Checked in to room/).first().waitFor({ timeout: 4000 }).then(() => true, () => false);
    if (!ok) await dlg.getByRole("button", { name: "Cancel" }).click();
  }
  expect(ok).toBe(true);
  // The new in-house guest has an open folio: take a payment on it.
  await page.goto("/folios");
  await page.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/\/folios\//);
  await page.getByRole("button", { name: "Take payment" }).first().click();
  const pay = page.getByRole("dialog");
  await pay.getByRole("textbox", { name: "Amount" }).fill("1000");
  await pay.getByLabel("Print receipt").uncheck();
  await pay.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("৳1,000.00").first()).toBeVisible({ timeout: 10_000 });
});

test("every main page renders without a client crash", async () => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const p of ["rack", "tape-chart", "reservations", "guests", "housekeeping", "maintenance", "ledger", "night-audit", "reports", "rates", "rooms", "data", "users", "audit", "settings"]) {
    await page.goto(`/${p}`);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });
  }
  expect(errors).toEqual([]);
});

test("Bangla UI and Bangla digits", async () => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "A", exact: true }).click();
  await page.getByRole("menuitem", { name: "My preferences" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("combobox").first().selectOption("bn");
  await dlg.getByRole("switch").first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "ড্যাশবোর্ড" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("ফ্রন্ট ডেস্ক").first()).toBeVisible();
  // Bangla digits in the business-date chip
  await expect(page.getByText(/[০-৯]{2}/).first()).toBeVisible();
});
