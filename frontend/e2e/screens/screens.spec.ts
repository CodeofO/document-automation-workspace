// 모듈 화면 캡처(1440px·980px). 기능 검증이 아니라 모듈 간 시각 비교용이다.
// 실행: E2E_BACKEND_PORT=8012 E2E_FRONTEND_PORT=5185 npx playwright test -c playwright.screens.config.ts
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedLibraryDocument, uniqueName } from "../helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, process.env.SCREENS_OUT ?? "../../../docs/ux/screens/4b");
const WIDTHS = [1440, 980];

async function shot(page: Page, name: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function soft(label: string, step: () => Promise<void>) {
  try {
    await step();
  } catch (error) {
    console.warn(`[screens] ${label} 건너뜀: ${(error as Error).message.split("\n")[0]}`);
  }
}

/** 보관함 화면에서 이름으로 문서를 고르고 모듈 실행 버튼을 누른다. */
async function sendFromLibrary(page: Page, names: string[], action: string) {
  await page.goto("/documents");
  for (const name of names) {
    await page.getByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")} `) }).click();
  }
  await page.getByRole("button", { name: action, exact: true }).click();
}

test("모듈 화면 캡처", async ({ page, request }) => {
  mkdirSync(OUT, { recursive: true });
  const names = [uniqueName("screen-a"), uniqueName("screen-b"), uniqueName("screen-c")];
  for (const name of names) await seedLibraryDocument(request, name);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, "01-home");

  await page.goto("/documents");
  await expect(page.getByRole("button", { name: new RegExp(`^${names[0].replace(".", "\\.")} `) })).toBeVisible();
  await shot(page, "02-documents");

  await page.goto("/raw");
  await shot(page, "03-raw-empty");

  await page.goto("/key-info");
  await page.waitForTimeout(800);
  await shot(page, "04-kie-empty");

  await soft("kie result", async () => {
    await sendFromLibrary(page, [names[0]], "핵심 정보 추출");
    await page.getByRole("button", { name: "샘플 schema 사용" }).click();
    await page.waitForTimeout(800);
    await shot(page, "05-kie-schema");
    await page.getByRole("button", { name: "실행", exact: true }).first().click();
    const extract = page.getByRole("button", { name: "추출", exact: true });
    if (await extract.isVisible().catch(() => false)) await extract.click();
    await expect(page.getByRole("heading", { level: 2, name: "추출 결과" })).toBeVisible({ timeout: 60_000 });
    await shot(page, "06-kie-review");
  });

  await page.goto("/classifier");
  await page.waitForTimeout(800);
  await shot(page, "07-classifier-empty");
  await soft("classifier batch", async () => {
    await sendFromLibrary(page, names, "문서 분류");
    await page.waitForTimeout(500);
    await shot(page, "08-classifier-selected");
    await page.getByRole("button", { name: "실행", exact: true }).first().click();
    await page.waitForTimeout(6000);
    await shot(page, "09-classifier-batch");
  });

  await page.goto("/required-check");
  await page.waitForTimeout(800);
  await shot(page, "10-required-empty");
  await soft("required batch", async () => {
    await sendFromLibrary(page, names, "필수 항목 확인");
    await page.getByRole("button", { name: "실행", exact: true }).first().click();
    await page.waitForTimeout(6000);
    await shot(page, "11-required-batch");
  });

  await page.goto("/rotation");
  await page.waitForTimeout(800);
  await shot(page, "12-rotation-empty");
  await soft("rotation batch", async () => {
    await sendFromLibrary(page, names, "회전 보정");
    await page.getByRole("button", { name: "실행", exact: true }).first().click();
    await page.waitForTimeout(6000);
    await shot(page, "13-rotation-batch");
  });

  await page.goto("/exports");
  await page.waitForTimeout(800);
  await shot(page, "14-exports");

  await page.goto("/");
  await page.getByRole("button", { name: "설정" }).click();
  await page.waitForTimeout(800);
  await shot(page, "15-settings");
});
