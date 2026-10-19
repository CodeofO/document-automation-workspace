// 표 추출 화면 캡처(1440px·980px) → docs/ux/screens/tables. 기능 검증이 아니라 다른 모듈과의 시각 비교용이다.
// 실행: E2E_BACKEND_PORT=8061 E2E_FRONTEND_PORT=5231 npx playwright test -c playwright.screens.config.ts e2e/screens/tables.spec.ts
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BACKEND_BASE, seedLibraryDocument, uniqueName } from "../helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, process.env.TABLE_SCREENS_OUT ?? "../../../docs/ux/screens/tables");
const WIDTHS = [1440, 980];

async function shot(page: Page, name: string, options: { fullPage?: boolean; height?: number } = {}) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: options.height ?? 900 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: options.fullPage });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

function column(key: string, type = "text", extra: Record<string, unknown> = {}) {
  return { key, type, header_path: [], ...extra };
}

test("표 추출 화면 캡처", async ({ page, request }) => {
  mkdirSync(OUT, { recursive: true });
  const docs = [];
  for (const prefix of ["table-screen-a", "table-screen-b"])
    docs.push(await seedLibraryDocument(request, uniqueName(prefix)));

  const created = await request.post(`${BACKEND_BASE}/api/table-templates`, {
    data: {
      name: `용해일지 ${Date.now()}`,
      description: "Lot 투입 표와 화학성분 격자",
      sample_refs: [{ document_id: docs[0].document_id, page_number: 1 }],
      tables: [
        {
          key: "lot_rows",
          name: "Lot 투입",
          description: "한 행 = Lot 1건",
          region: { x: 0.06, y: 0.18, width: 0.88, height: 0.36 },
          end_hint: "합계 줄 위까지",
          row_count: { mode: "max", value: 16 },
          columns: [
            column("Lot No", "text", { header_path: ["Lot", "No"], description: "숫자·영문 6자리", required: true }),
            column("단중", "number"),
            column("실적", "number"),
            column("중량", "number"),
            column("잔량", "choice", { choices: ["완"], choice_allow_number: true }),
            column("레들", "checkbox", { checkbox_options: ["A1", "A2", "A3"] })
          ],
          rules: [{ kind: "row_formula", expression: "중량 = 단중 * 실적", tolerance: 0.01 }]
        },
        {
          key: "chem",
          name: "화학성분",
          region: { x: 0.06, y: 0.6, width: 0.6, height: 0.2 },
          columns: [column("원소"), column("값", "number")]
        },
        {
          key: "work_times",
          name: "작업 시각",
          region: { x: 0.7, y: 0.6, width: 0.24, height: 0.3 },
          columns: [column("작업"), column("시작", "time"), column("종료", "time")]
        }
      ]
    }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const template = await created.json();

  // 양식 편집기
  await page.goto(`/tables/templates/${template.id}`);
  await expect(page.locator(".ui-multi-region-canvas img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lot 투입 영역" })).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, "01-template-editor");

  // 실행·검토 화면(배치 2페이지)
  const batchResponse = await request.post(`${BACKEND_BASE}/api/table-extraction-batches/from-documents`, {
    data: { template_id: template.id, document_ids: docs.map((doc) => doc.document_id) }
  });
  expect(batchResponse.ok(), await batchResponse.text()).toBeTruthy();
  const batch = await batchResponse.json();
  await page.goto(`/tables?batch=${batch.id}`);
  const grid = page.getByRole("table", { name: "Lot 투입 결과" });
  await expect(grid).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".ui-batch-rail-item", { hasText: "실행 중" })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".ui-batch-rail-item", { hasText: "대기 중" })).toHaveCount(0, { timeout: 30_000 });
  await grid.locator("tbody tr").first().locator(".table-row-select").click();
  await expect(page.getByTestId("table-row-band")).toBeVisible();
  await shot(page, "02-review");

  await grid.getByRole("button", { name: /^2행 단중:/ }).click();
  await page.getByLabel("칸 값").fill("4.0");
  await page.getByRole("button", { name: "적용" }).click();
  await grid.getByRole("button", { name: /^1행 실적:/ }).click();
  await shot(page, "03-review-cell-popover");

  // 홈 카드
  await page.keyboard.press("Escape");
  await page.goto("/");
  await expect(page.locator(".feature-card", { hasText: "Table Extraction" })).toBeVisible();
  // 기능 카드 격자 전체가 보이게 찍는다(넓은 화면은 앱 셸 안에서 스크롤하므로 창 높이를 늘린다).
  await shot(page, "04-home", { fullPage: true, height: 1180 });
});
