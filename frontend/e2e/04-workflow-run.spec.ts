import { expect, test } from "@playwright/test";
import { createReviewWorkflow, openWorkflow, pickRunDocuments, seedLibraryDocument } from "./helpers";

test("워크플로우: API로 만든 분류·검수 워크플로우를 3개 문서로 끝까지 실행한다", async ({ page, request }) => {
  test.setTimeout(150_000);
  // 에셋·워크플로우는 기존 API로 만들고, 문서는 그때그때 만든 PNG를 보관함에 올린다.
  const { workflow } = await createReviewWorkflow(request);
  const tag = `wfrun${Date.now()}`;
  const filenames = [`${tag}-a.png`, `${tag}-b.png`, `${tag}-c.png`];
  for (const [index, filename] of filenames.entries()) await seedLibraryDocument(request, filename, index + 1);

  await openWorkflow(page, workflow);
  await expect(page.getByRole("application").getByText("서류 분류", { exact: true })).toBeVisible();

  await pickRunDocuments(page, tag, filenames);
  await page.getByRole("button", { name: "실행", exact: true }).click();
  await expect(page.getByText("문서 보관함 기준으로 워크플로우 실행을 시작했습니다.")).toBeVisible();

  // 실행 현황은 오른쪽 패널 "실행" 탭에 있다. 실행이 시작돼도 탭은 자동으로 바뀌지 않는다.
  const runsTab = page.getByRole("tab", { name: /^실행/ });
  await expect(page.getByRole("tab", { name: "속성" })).toHaveAttribute("aria-selected", "true");
  await runsTab.click();
  const runs = page.getByRole("region", { name: "워크플로우 실행 현황" });
  const latestRun = runs.getByRole("button", { name: new RegExp(workflow.name) }).first();
  await expect(latestRun).toContainText("3 / 3 처리", { timeout: 60_000 });
  await expect(latestRun).toContainText(/검토 필요|완료/);

  await latestRun.getByRole("button", { name: "결과 보기" }).click();
  await expect(page).toHaveURL(/\/workflow-runs\//);
});

test("워크플로우 빌더: 경로 없이 들어오면 저장된 워크플로우를 자동으로 연다", async ({ page, request }) => {
  await createReviewWorkflow(request);
  await page.goto("/workflows");
  await expect(page.getByRole("heading", { level: 1, name: "워크플로우 빌더" })).toBeVisible();
  // 손대지 않은 기본 캔버스면 저장 워크플로우 하나가 불러와진다(빈 새 워크플로우가 아님).
  await expect(page.getByRole("combobox", { name: "워크플로우 불러오기" })).not.toHaveValue("");
  // 투어·데모 안내는 없다.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
