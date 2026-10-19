import { expect, test } from "@playwright/test";
import { pngFile, uniqueName } from "./helpers";

test("문서 보관함에 이미지를 올리면 준비 완료가 된다", async ({ page }) => {
  const name = uniqueName("library");
  await page.goto("/documents");
  await expect(page.getByRole("heading", { level: 1, name: "문서 보관함" })).toBeVisible();

  // "파일 추가" 버튼이 여는 숨은 file input에 직접 파일을 넣는다.
  await page
    .locator('input[type="file"]:not([webkitdirectory])')
    .first()
    .setInputFiles(pngFile(name));

  const card = page.getByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")} `) });
  await expect(card).toBeVisible();
  await expect(card).toContainText("준비 완료", { timeout: 60_000 });
});
