import { expect, test, type Page } from "@playwright/test";
import { BACKEND_BASE, seedLibraryDocument, uniqueName } from "./helpers";

async function pickFromLibrary(page: Page, name: string) {
  await page.getByRole("button", { name: "보관함에서 선택", exact: true }).click();
  const picker = page.getByRole("dialog");
  await expect(picker.getByRole("heading", { name: "실행할 문서 선택" })).toBeVisible();
  await picker.getByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")} `) }).click();
  await picker.getByRole("button", { name: "선택 적용" }).click();
}

test("표 추출: 양식(표 1개·칼럼 2개·영역)을 만들고 보관함 문서를 mock VLM으로 읽어 칸을 고친다", async ({
  page,
  request
}) => {
  const docName = uniqueName("table");
  const templateName = `e2e 표 양식 ${Date.now()}`;
  await seedLibraryDocument(request, docName);

  // 홈 카드 → 검토 화면 → 새 양식
  await page.goto("/");
  await page.getByRole("button", { name: /^표 추출 / }).click();
  await expect(page.getByRole("heading", { level: 1, name: "표 추출" })).toBeVisible();
  await page.getByRole("button", { name: "새 양식" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "표 양식 편집" })).toBeVisible();

  // 샘플 이미지(보관함)
  await pickFromLibrary(page, docName);
  const canvas = page.locator(".ui-multi-region-canvas");
  await expect(canvas.locator("img")).toBeVisible();

  await page.getByLabel("양식 이름").fill(templateName);
  await page.getByRole("button", { name: "표 추가" }).first().click();
  await page.getByLabel("표 이름").fill("주입 내역");
  await page.getByLabel("칼럼 1 이름").fill("품명");
  await page.getByRole("button", { name: "칼럼 추가" }).click();
  await page.getByLabel("칼럼 2 이름").fill("수량");
  await page.getByLabel("칼럼 2 형식").selectOption("number");

  // 영역 그리기
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas not visible");
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.7, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "주입 내역 영역" })).toBeVisible();
  await expect(page.getByText(/영역 x 0\.\d{3}/)).toBeVisible();

  // AI 칼럼 초안(mock: 품명·수량·작업일 3칼럼) — 두 번째 표에 받는다.
  await page.getByRole("tablist", { name: "표 스키마" }).getByRole("button", { name: "표 추가" }).click();
  await expect(page.getByLabel("표 이름")).toHaveValue("표 2");
  await page.getByRole("button", { name: "AI로 칼럼 초안" }).click();
  await expect(page.getByText(/AI 칼럼 초안 3개를 넣었습니다/)).toBeVisible();
  await expect(page.getByLabel("칼럼 3 이름")).toHaveValue("작업일");
  await expect(page.getByLabel("칼럼 2 형식")).toHaveValue("number");
  await page.getByRole("tab", { name: /주입 내역/ }).click();

  // 자동 저장 → 실행 화면
  await expect(page.getByRole("status").filter({ hasText: "저장됨" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "이 양식으로 실행" }).click();
  await expect(page).toHaveURL(/\/tables\?template=/);
  await expect(page.getByLabel("실행할 표 양식")).toHaveValue(/table_template_/);

  await pickFromLibrary(page, docName);
  await page.getByRole("button", { name: "실행", exact: true }).click();

  // mock VLM은 정의에 맞는 결정적 행 2개를 돌려준다.
  const grid = page.getByRole("table", { name: "주입 내역 결과" });
  await expect(grid).toBeVisible({ timeout: 60_000 });
  await expect(grid.getByRole("button", { name: /^1행 품명: 품명 1/ })).toBeVisible();
  await expect(grid.getByRole("button", { name: /^2행 수량: 3\.5/ })).toBeVisible();
  await expect(grid.locator("tbody tr")).toHaveCount(2);

  // 행 선택 → 원본 위 띠
  await grid.getByRole("button", { name: "1", exact: true }).click();
  await expect(page.getByTestId("table-row-band")).toBeVisible();

  // 칸 수정 → 저장 → 수정됨 표시
  await grid.getByRole("button", { name: /^1행 수량: 12/ }).click();
  const popover = page.getByRole("dialog", { name: /1행 · 수량 칸/ });
  await popover.getByLabel("칸 값").fill("15");
  await popover.getByRole("button", { name: "적용" }).click();
  await expect(grid.getByRole("button", { name: /^1행 수량: 15 \(저장 전\)/ })).toBeVisible();
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect(page.getByText("수정한 표를 저장했습니다.")).toBeVisible();
  await expect(grid.getByRole("button", { name: /^1행 수량: 15 \(수정됨\)/ })).toBeVisible();

  // 이 페이지 export(서버 파일, 수정본 우선)
  await page.locator(".table-result-card").getByRole("button", { name: "Export" }).click();
  const xlsxLink = page.getByRole("menuitem", { name: "XLSX" });
  const href = await xlsxLink.getAttribute("href");
  expect(href).toContain("/export?format=xlsx");
  const xlsx = await request.get(href as string);
  expect(xlsx.ok()).toBeTruthy();
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  const jsonHref = await page.getByRole("menuitem", { name: "JSON" }).getAttribute("href");
  const single = await (await request.get(jsonHref as string)).json();
  const injection = single.tables.find((table: { table_key: string }) => table.table_key === "table_1");
  expect(injection.rows[0].cells["수량"].value).toBe(15);
  await page.keyboard.press("Escape");

  // 배치 export(export job)
  const batchId = new URL(page.url()).searchParams.get("batch");
  expect(batchId).toBeTruthy();
  const popup = page.waitForEvent("popup").catch(() => null);
  await page.getByRole("region", { name: "작업 진행 상태" }).getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "XLSX" }).click();
  await popup;
  await expect
    .poll(
      async () => {
        const res = await request.get(
          `${BACKEND_BASE}/api/export-jobs?owner_type=table_extraction_batch&owner_id=${batchId}`
        );
        const jobs = (await res.json()) as { status: string; format: string }[];
        return jobs.find((job) => job.format === "xlsx")?.status;
      },
      { timeout: 30_000 }
    )
    .toBe("completed");
});
