import { expect, test } from "@playwright/test";
import { seedLibraryDocument, uniqueName } from "./helpers";

test("회전 보정: 보관함 문서를 골라 실행하면 완료 결과가 보인다", async ({ page, request }) => {
  const name = uniqueName("rotation");
  await seedLibraryDocument(request, name);

  await page.goto("/rotation");
  await expect(page.getByRole("heading", { level: 1, name: "회전 보정" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "실행 대기" })).toBeVisible();

  await page.getByRole("button", { name: "보관함에서 선택", exact: true }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")} `) }).click();
  await picker.getByRole("button", { name: "선택 적용" }).click();

  await page.getByRole("button", { name: "실행", exact: true }).click();
  await expect(page.getByText("1개 보관 문서의 회전 보정을 시작했습니다.", { exact: false })).toBeVisible();

  await expect(page.getByRole("heading", { level: 2, name: "완료" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("tablist", { name: "결과 필터" })).toBeVisible();
  const result = page.getByRole("article").filter({ hasText: name });
  await expect(result).toContainText(/1페이지\s*완료/);
  await expect(result).toContainText("정방향 (변경 없음)");
});
