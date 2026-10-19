// 워크플로우 화면 노드 선택 · Inspector · 에셋 편집 Drawer (docs/ux/workflow-inspector-spec.md)
// 화면 캡처: WORKFLOW_SCREENS_OUT=<dir>을 주면 두 번째 테스트가 1440px·1100px 캡처를 남긴다(평소에는 건너뜀).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createReviewWorkflow, openWorkflow, pickRunDocuments, seedLibraryDocument } from "./helpers";

/** API로 분류·검수 워크플로우를 만들고 빌더에서 연다. */
async function openReviewWorkflow(page: Page, request: APIRequestContext) {
  const { workflow } = await createReviewWorkflow(request);
  await openWorkflow(page, workflow);
}

function canvasNode(page: Page, label: string) {
  return page.locator(".react-flow__node").filter({ hasText: label });
}

test("워크플로우: 노드 클릭은 선택만 하고, Enter·버튼으로만 에셋 편집 Drawer가 열린다", async ({ page, request }) => {
  await openReviewWorkflow(page, request);

  // 처음에는 아무것도 선택되지 않고 워크플로우 Inspector가 보인다.
  const panel = page.getByRole("complementary", { name: "오른쪽 패널" });
  await expect(panel.getByRole("region", { name: "워크플로우 속성" })).toBeVisible();
  const canvas = page.locator(".workflow-canvas");
  const canvasBefore = await canvas.boundingBox();

  // 클릭: 창이 뜨지 않고 Inspector만 바뀐다. 캔버스 크기도 그대로다.
  const kieNode = canvasNode(page, "신청서 핵심 정보 추출");
  await expect(kieNode).toContainText("스키마:");
  await kieNode.click();
  await expect(panel.getByRole("textbox", { name: "노드 이름" })).toHaveValue("신청서 핵심 정보 추출");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".ui-drawer-backdrop")).toHaveCount(0);
  expect(await canvas.boundingBox()).toEqual(canvasBefore);
  await expect(panel.getByRole("combobox", { name: "스키마 선택" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "스키마 요약" })).toBeVisible();

  // Enter: Drawer가 열린다. Esc: Drawer만 닫히고 선택은 남는다.
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: /신청서 핵심 정보 추출/ });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("region", { name: "Schema 편집" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(panel.getByRole("textbox", { name: "노드 이름" })).toHaveValue("신청서 핵심 정보 추출");

  // 버튼으로도 연다. 편집하면 노드에 ● 초안 배지가 생긴다. "완료"로 닫는다.
  await panel.getByRole("button", { name: "에셋 편집" }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("textbox", { name: "schema 설명" }).fill("e2e 수정");
  await drawer.getByRole("button", { name: "완료" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(kieNode.locator(".wf-node-badge[data-tone='draft']")).toBeVisible();
  await expect(panel.getByText("● 미저장 초안")).toBeVisible();
  await panel.getByRole("button", { name: "초안 버리기" }).click();
  await expect(kieNode.locator(".wf-node-badge[data-tone='draft']")).toHaveCount(0);

  // 다른 노드를 클릭해도 Drawer는 열리지 않는다(분류 노드도 에셋 노드).
  await canvasNode(page, "서류 분류").click();
  await expect(panel.getByRole("textbox", { name: "노드 이름" })).toHaveValue("서류 분류");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Esc: 선택 해제 → 워크플로우 Inspector.
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("region", { name: "워크플로우 속성" })).toBeVisible();

  // 실행 탭은 그대로 동작하고, 다시 속성 탭으로 돌아올 수 있다.
  await panel.getByRole("tab", { name: /^실행/ }).click();
  await expect(panel.getByRole("region", { name: "워크플로우 실행 현황" })).toBeVisible();
  await panel.getByRole("tab", { name: "속성" }).click();
  await expect(panel.getByRole("region", { name: "워크플로우 속성" })).toBeVisible();

  // 패널 접기(⌘/Ctrl+\)는 40px 레일로 바뀌고 다시 펼칠 수 있다.
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(page.getByRole("complementary", { name: "오른쪽 패널(접힘)" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(panel).toBeVisible();
});

test("워크플로우 화면 캡처(4C)", async ({ page, request }) => {
  const out = process.env.WORKFLOW_SCREENS_OUT;
  test.skip(!out, "WORKFLOW_SCREENS_OUT이 없으면 캡처하지 않는다");
  const dir = path.resolve(out as string);
  mkdirSync(dir, { recursive: true });
  const panel = page.getByRole("complementary", { name: "오른쪽 패널" });
  const tag = `wfcap${Date.now()}`;
  const filenames = [`${tag}-a.png`, `${tag}-b.png`];
  for (const [index, filename] of filenames.entries()) await seedLibraryDocument(request, filename, index + 1);

  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await openReviewWorkflow(page, request);
    // 탭 선택은 localStorage에 남는다(의도). 캡처는 매번 속성 탭에서 시작한다.
    await panel.getByRole("tab", { name: "속성" }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(dir, `01-empty-selection-${width}.png`) });

    await canvasNode(page, "신청서 핵심 정보 추출").click();
    await expect(panel.getByRole("textbox", { name: "노드 이름" })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir, `02-node-selected-${width}.png`) });

    await panel.getByRole("button", { name: "에셋 편집" }).click();
    await expect(page.getByRole("dialog", { name: /신청서 핵심 정보 추출/ })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir, `03-drawer-open-${width}.png`) });
    await page.keyboard.press("Escape");

    await canvasNode(page, "문서 종류 분기").click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir, `04-branch-selected-${width}.png`) });

    await pickRunDocuments(page, tag, filenames);
    await page.getByRole("button", { name: "실행", exact: true }).click();
    await expect(page.getByText("문서 보관함 기준으로 워크플로우 실행을 시작했습니다.")).toBeVisible();
    await panel.getByRole("tab", { name: /^실행/ }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(dir, `05-run-tab-${width}.png`) });
  }
});
