import { expect, test } from "@playwright/test";
import { openHome } from "./helpers";

const MODULES = [
  { card: "문서 보관함", heading: "문서 보관함" },
  { card: "원문 데이터 추출", heading: "원문 데이터 추출" },
  { card: "핵심 정보 추출", heading: "핵심 정보 추출" },
  { card: "표 추출", heading: "표 추출" },
  { card: "문서 분류", heading: "문서 분류" },
  { card: "필수 항목 확인", heading: "필수 항목 확인" },
  { card: "회전 보정", heading: "회전 보정" }
];

test("홈이 열리고 각 모듈로 이동했다가 홈으로 돌아온다", async ({ page }) => {
  await openHome(page);
  await expect(page.getByRole("button", { name: "워크플로우 빌더 열기" })).toBeVisible();

  for (const module of MODULES) {
    await page.getByRole("button", { name: new RegExp(`^${module.card} `) }).click();
    await expect(page.getByRole("heading", { level: 1, name: module.heading })).toBeVisible();
    await page.getByRole("button", { name: "홈", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "문서 검수를 한 번에 자동화하세요" })).toBeVisible();
  }

  await page.getByRole("button", { name: "워크플로우 빌더 열기" }).click();
  await expect(page).toHaveURL(/\/workflows$/);
});
