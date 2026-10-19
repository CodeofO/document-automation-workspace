import { expect, test } from "@playwright/test";
import { seedLibraryDocument, uniqueName } from "./helpers";

test("핵심 정보 추출: 샘플 schema로 보관함 문서를 mock VLM 추출한다", async ({ page, request }) => {
  const name = uniqueName("kie");
  await seedLibraryDocument(request, name);

  await page.goto("/key-info");
  await expect(page.getByRole("heading", { level: 1, name: "핵심 정보 추출" })).toBeVisible();

  await page.getByRole("button", { name: "샘플 schema 사용" }).click();
  // 문서 입력(DocumentInput): 보관함에서 선택
  await page.getByRole("button", { name: "보관함에서 선택", exact: true }).click();
  const picker = page.getByRole("dialog");
  await expect(picker.getByRole("heading", { name: "실행할 문서 선택" })).toBeVisible();
  await picker.getByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")} `) }).click();
  await picker.getByRole("button", { name: "선택 적용" }).click();

  // 한 문서를 고르면 바로 뷰어로 열린다.
  await expect(page.getByRole("heading", { level: 2, name }).first()).toBeVisible();
  await page.getByRole("button", { name: "실행", exact: true }).click();

  await expect(page.getByRole("heading", { level: 2, name: "추출 결과" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Mock evidence for 문서번호").first()).toBeVisible();
  await expect(page.getByText("0 / 5개 검수됨")).toBeVisible();
});
