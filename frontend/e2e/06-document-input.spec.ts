import { expect, test } from "@playwright/test";
import { dropFile, makePdf, pngFile, uniqueName } from "./helpers";

// 공용 DocumentInput: 파일 선택·끌어다 놓기 → 보관함 업로드 → 모듈 실행(페이지 단위).
const ZONE = ".ui-document-input";
const ZONE_FILE_INPUT = `${ZONE} input[type="file"]:not([webkitdirectory])`;

test("문서 분류: 파일 선택으로 올린 이미지를 실행한다", async ({ page }) => {
  const name = uniqueName("cls-file");
  await page.goto("/classifier");
  await expect(page.getByRole("heading", { level: 1, name: "문서 분류" })).toBeVisible();

  await page.locator(ZONE_FILE_INPUT).setInputFiles(pngFile(name));
  await expect(page.getByText("1개 보관 문서를 선택했습니다.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 2, name }).first()).toBeVisible();

  await page.getByRole("button", { name: "실행", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: `${name} · p.1` }).first()).toBeVisible({ timeout: 60_000 });
});

test("문서 분류: 3페이지 PDF를 끌어다 놓으면 페이지마다 결과 행(p.1~p.3)이 생긴다", async ({ page }) => {
  const name = uniqueName("cls-drop", "pdf");
  await page.goto("/classifier");
  await expect(page.locator(ZONE)).toBeVisible();

  await dropFile(page, ZONE, { name, mimeType: "application/pdf", buffer: makePdf(3) });
  await expect(page.getByText("1개 보관 문서를 선택했습니다.")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "실행", exact: true }).click();
  const rail = page.getByRole("navigation", { name: "배치 항목" });
  for (const pageNumber of [1, 2, 3]) {
    await expect(rail.getByText(`${name} · p.${pageNumber}`)).toBeVisible({ timeout: 60_000 });
  }
  await expect(page.getByRole("region", { name: "작업 진행 상태" })).toContainText("처리 3 / 3", { timeout: 60_000 });
});

test("회전 보정: 끌어다 놓기와 헤더의 파일 선택으로 문서를 고르고 보정한다", async ({ page }) => {
  const dropped = uniqueName("rot-drop");
  const picked = uniqueName("rot-file");
  await page.goto("/rotation");
  await expect(page.getByRole("heading", { level: 2, name: "실행 대기" })).toBeVisible();

  await dropFile(page, ZONE, pngFile(dropped));
  await expect(page.getByText("1개 보관 문서를 선택했습니다.")).toBeVisible({ timeout: 30_000 });

  // 헤더의 "문서 추가 ▾" 버튼(button 변형)도 같은 입력을 쓴다: 숨은 file input에 파일을 넣는다.
  await page
    .locator('.ui-page-header input[type="file"]:not([webkitdirectory])')
    .setInputFiles(pngFile(picked));
  await expect(page.getByRole("button", { name: /1개 문서 선택됨/ })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "실행", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "완료" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("article").filter({ hasText: picked })).toContainText("정방향 (변경 없음)");
});
