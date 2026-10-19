// 워크플로우 실행 결과 창(/workflow-runs/:runId) 오른쪽 문서 결과 패널의 레이아웃.
// 규칙(docs/ux/module-unification-spec.md B-4): 세로 스크롤은 패널 하나, 섹션·표는 자기 높이만큼(내부 세로 스크롤 없음).
// 화면 캡처: RUN_RESULT_SCREENS_OUT=<dir>을 주면 1440×900·1100×800 캡처를 남긴다(평소에는 건너뜀).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { BACKEND_BASE, BRANCH_KEYS, createWorkflowAssets, seedLibraryDocument, uniqueName } from "./helpers";

/** 회전 → 분류 → 분기 → KIE → 필수 항목 → 표 추출 → Export 워크플로우를 API로 만들고 생성한 PNG 문서 3건으로 끝까지 돌린다. */
async function createFinishedRun(request: APIRequestContext): Promise<string> {
  const assets = await createWorkflowAssets(request);
  const documents: Awaited<ReturnType<typeof seedLibraryDocument>>[] = [];
  for (const seedValue of [1, 2, 3]) documents.push(await seedLibraryDocument(request, uniqueName("run-result"), seedValue));
  const templateResponse = await request.post(`${BACKEND_BASE}/api/table-templates`, {
    data: {
      name: `e2e 결과 창 표 양식 ${Date.now()}`,
      tables: [
        {
          key: "items",
          name: "품목 내역",
          columns: [
            { key: "품명", type: "text" },
            { key: "수량", type: "number" }
          ]
        },
        {
          key: "notes",
          name: "비고 내역",
          columns: [
            { key: "코드", type: "text" },
            { key: "비고", type: "text" }
          ]
        }
      ]
    }
  });
  expect(templateResponse.ok(), await templateResponse.text()).toBeTruthy();
  const template = (await templateResponse.json()) as { id: string };

  const branchKeys = BRANCH_KEYS;
  const node = (id: string, kind: string, label: string, x: number, config?: Record<string, unknown>) => ({
    id,
    position: { x, y: 200 },
    data: { kind, label, ...(config ? { config } : {}) }
  });
  const nodes = [
    node("input", "input", "문서 입력", 0),
    node("rotation", "rotation", "회전 보정", 200, {}),
    node("classifier", "classifier", "서류 분류", 400, { classifier_id: assets.classifier.id }),
    {
      ...node("branch", "branch", "문서 종류 분기", 600),
      data: { kind: "branch", label: "문서 종류 분기", branchKeys }
    },
    node("kie", "kie", "핵심 정보 추출", 800, { schema_id: assets.schema.id }),
    node("required", "required-checker", "필수 항목 확인", 1000, { checklist_id: assets.checklist.id }),
    node("table", "table", "표 추출", 1200, { template_id: template.id, table_keys: ["items", "notes"] }),
    node("export", "export", "Export", 1400)
  ];
  const edges = [
    { id: "e1", source: "input", target: "rotation" },
    { id: "e2", source: "rotation", target: "classifier" },
    { id: "e3", source: "classifier", target: "branch" },
    ...branchKeys.map((key, index) => ({ id: `b${index}`, source: "branch", target: "kie", sourceHandle: key })),
    { id: "e4", source: "kie", target: "required" },
    { id: "e5", source: "required", target: "table" },
    { id: "e6", source: "table", target: "export" }
  ];
  const workflowResponse = await request.post(`${BACKEND_BASE}/api/workflows`, {
    data: { name: `e2e 결과 창 ${Date.now()}`, definition: { nodes, edges } }
  });
  expect(workflowResponse.ok(), await workflowResponse.text()).toBeTruthy();
  const workflow = (await workflowResponse.json()) as { id: string };
  const runResponse = await request.post(`${BACKEND_BASE}/api/workflows/${workflow.id}/runs/from-documents`, {
    data: { document_ids: documents.map((document) => document.document_id) }
  });
  expect(runResponse.ok(), await runResponse.text()).toBeTruthy();
  const run = (await runResponse.json()) as { id: string };
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${BACKEND_BASE}/api/workflow-runs/${run.id}`)).json()) as { status: string })
          .status,
      { timeout: 90_000 }
    )
    .toMatch(/^(completed|needs_review|completed_with_errors)$/);
  return run.id;
}

/** 패널 안(패널 포함)에서 세로로 스크롤되는 요소의 class 목록. */
function verticalScrollers(page: Page) {
  return page.getByRole("complementary", { name: "문서 결과" }).evaluate((panel) => {
    const found: string[] = [];
    for (const element of [panel, ...Array.from(panel.querySelectorAll("*"))]) {
      const overflowY = getComputedStyle(element).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight + 1) {
        found.push(String(element.className || element.tagName));
      }
    }
    return found;
  });
}

let runId = "";

test.beforeAll(async ({ request }) => {
  test.setTimeout(150_000);
  runId = await createFinishedRun(request);
});

test("결과 창: 오른쪽 패널 하나만 세로 스크롤하고 KIE·필수 항목·표 결과가 온전한 높이로 보인다", async ({ page }) => {
  await page.goto(`/workflow-runs/${encodeURIComponent(runId)}`);
  const panel = page.getByRole("complementary", { name: "문서 결과" });
  await expect(panel.getByRole("heading", { level: 3 })).toContainText("p.1");

  // KIE 결과: 접힘 카드 헤더에 개수, 표는 3행 이상이 내부 스크롤 없이 보인다.
  const kieHeader = panel.getByRole("button", { name: /KIE 결과/ });
  await expect(kieHeader).toHaveAttribute("aria-expanded", "true");
  await expect(kieHeader).toContainText("5필드");
  const kieTable = panel.getByRole("table", { name: "KIE 결과" });
  const kieRows = kieTable.locator("tbody tr");
  expect(await kieRows.count()).toBeGreaterThanOrEqual(3);
  const kieWrap = kieTable.locator("xpath=..");
  const kieWrapSize = await kieWrap.evaluate((element) => ({
    client: element.clientHeight,
    scroll: element.scrollHeight
  }));
  expect(kieWrapSize.client).toBeGreaterThanOrEqual(kieWrapSize.scroll);
  const wrapBox = (await kieWrap.boundingBox())!;
  for (let index = 0; index < 3; index += 1) {
    const rowBox = (await kieRows.nth(index).boundingBox())!;
    expect(rowBox.height).toBeGreaterThan(20);
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(wrapBox.y + wrapBox.height + 1);
  }

  // 필수 항목 · 표 추출(요약 + 읽기 전용 미리보기)도 온전한 높이.
  const requiredTable = panel.getByRole("table", { name: "필수 항목 결과" });
  await expect(requiredTable.locator("tbody tr")).toHaveCount(4);
  const requiredWrap = await requiredTable
    .locator("xpath=..")
    .evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  expect(requiredWrap.client).toBeGreaterThanOrEqual(requiredWrap.scroll);
  await expect(panel.getByRole("table", { name: "표 추출 요약" }).locator("tbody tr")).toHaveCount(2);
  await expect(panel.getByRole("table", { name: "품목 내역 미리보기" }).locator("tbody tr")).toHaveCount(2);
  await expect(panel.getByRole("link", { name: "품목 내역 전체 보기" })).toHaveAttribute("href", /\/tables\?job=/);

  // 세로 스크롤 컨테이너는 패널 하나뿐이다.
  expect(await verticalScrollers(page)).toEqual([expect.stringContaining("workflow-item-detail")]);

  // 섹션 카드는 접고 펼 수 있고, 위쪽 칩으로 섹션을 다시 펼치며 이동한다.
  await kieHeader.click();
  await expect(kieHeader).toHaveAttribute("aria-expanded", "false");
  await expect(kieTable).toHaveCount(0);
  await panel.getByRole("navigation", { name: "결과 섹션 이동" }).getByRole("button", { name: /KIE/ }).click();
  await expect(kieHeader).toHaveAttribute("aria-expanded", "true");
  await expect(kieTable).toBeVisible();
});

test("결과 창 헤더: 한 줄로 낮게, 최근 export는 Export 메뉴 안에 둔다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workflow-runs/${encodeURIComponent(runId)}`);
  const header = page.getByRole("region", { name: "실행 요약" });
  await expect(header).toBeVisible();
  await expect(header.locator(".wf-run-header-stats")).toContainText("3/3 처리");
  // 끝난 run에서는 0인 진행 카운터(전처리·대기·AI 요청)를 숨긴다.
  await expect(header).not.toContainText("AI 요청");
  await expect(header).not.toContainText("전처리");
  const headerBox = (await header.boundingBox())!;
  expect(headerBox.height).toBeLessThanOrEqual(64);

  // "최근 export" 카드는 화면에 없고 Export 메뉴 footer에 있다.
  await expect(page.getByText("최근 export 없음")).toHaveCount(0);
  await header.getByRole("button", { name: "Export" }).click();
  const menu = page.getByRole("menu", { name: "Export 형식" });
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  await expect(menu).toContainText("최근 export");
  await page.keyboard.press("Escape");

  // 작업대가 화면 높이 대부분을 쓴다(헤더+진행 막대 아래부터).
  const workbench = (await page.locator(".workflow-run-workbench").boundingBox())!;
  expect(workbench.height).toBeGreaterThan(900 * 0.6);

  await header.getByRole("button", { name: "닫기" }).click();
  await expect(page).toHaveURL(/\/workflows$/);
});

/** 진행 중 헤더를 캡처하려고 run 응답을 "처리 중"으로 바꿔 돌려준다(화면 확인용). */
async function fakeRunningRun(page: Page) {
  await page.route(
    (url) => url.pathname === `/api/workflow-runs/${runId}`,
    async (route) => {
      const response = await route.fetch();
      const run = await response.json();
      await route.fulfill({
        response,
        json: {
          ...run,
          status: "running",
          progress_phase: "running",
          progress: 0.4,
          completed_at: null,
          completed_count: 0,
          needs_review_count: 1,
          failed_count: 0,
          preprocessing_count: 0,
          running_count: 1,
          queued_count: 1,
          vlm_active_count: 2,
          vlm_limit: 8,
          vlm_waiting_count: 1
        }
      });
    }
  );
}

test("결과 창 화면 캡처(run-result)", async ({ page }) => {
  const out = process.env.RUN_RESULT_SCREENS_OUT;
  test.skip(!out, "RUN_RESULT_SCREENS_OUT이 없으면 캡처하지 않는다");
  const dir = path.resolve(out as string);
  mkdirSync(dir, { recursive: true });
  for (const [width, height] of [
    [1440, 900],
    [1100, 800]
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`/workflow-runs/${encodeURIComponent(runId)}`);
    await expect(page.getByRole("table", { name: "KIE 결과" })).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(dir, `after-${width}x${height}.png`) });
    const box = await page.getByRole("region", { name: "실행 요약" }).boundingBox();
    console.log(`run-result header ${width}x${height}: ${box?.height}px`);
  }

  // Export 메뉴(최근 export footer)를 연 모습.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workflow-runs/${encodeURIComponent(runId)}`);
  await expect(page.getByRole("table", { name: "KIE 결과" })).toBeVisible();
  await page.getByRole("region", { name: "실행 요약" }).getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("menu", { name: "Export 형식" })).toContainText("최근 export");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(dir, "after-1440x900-export-menu.png") });

  // 진행 중 헤더(1440 · 1100).
  await fakeRunningRun(page);
  for (const [width, height] of [
    [1440, 900],
    [1100, 800]
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`/workflow-runs/${encodeURIComponent(runId)}`);
    await expect(page.getByRole("region", { name: "실행 요약" })).toContainText("AI 요청");
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(dir, `after-${width}x${height}-running.png`) });
    const box = await page.getByRole("region", { name: "실행 요약" }).boundingBox();
    console.log(`run-result header (running) ${width}x${height}: ${box?.height}px`);
  }
});
