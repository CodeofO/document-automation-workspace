// 워크플로우 "표 추출" 노드: 팔레트로 추가 → 선 연결 → Inspector에서 양식·실행할 표 선택 → 저장 → 실행 → 결과 확인.
// (docs/table-extraction-api.md §8)
import { expect, test, type Locator, type Page } from "@playwright/test";
import { BACKEND_BASE, createReviewWorkflow, seedLibraryDocument, uniqueName } from "./helpers";

function canvasNodeByKind(page: Page, kind: string) {
  return page.locator(".react-flow__node").filter({ has: page.locator(`[data-node-kind='${kind}']`) });
}

/** React Flow 핸들 끌기로 두 노드를 잇는다. */
async function connectNodes(page: Page, source: Locator, target: Locator) {
  const from = await source.locator(".react-flow__handle.source").boundingBox();
  const to = await target.locator(".react-flow__handle.target").boundingBox();
  if (!from || !to) throw new Error("handle not visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
}

test("워크플로우: 표 추출 노드를 연결·저장·실행하고 결과에서 검토 화면을 연다", async ({ page, context, request }) => {
  test.setTimeout(150_000);
  const docName = uniqueName("wf-table");
  const templateName = `e2e 워크플로우 표 양식 ${Date.now()}`;
  const workflowName = `e2e 표 워크플로우 ${Date.now()}`;

  // 양식(표 2개 · 칼럼 2개씩)과 보관함 문서를 API로 준비한다.
  const created = await request.post(`${BACKEND_BASE}/api/table-templates`, {
    data: {
      name: templateName,
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
  expect(created.ok(), await created.text()).toBeTruthy();
  const template = (await created.json()) as { id: string };
  await seedLibraryDocument(request, docName);
  // 저장 워크플로우가 하나는 있어야 빌더가 그것을 자동으로 열고, 거기서 "새 워크플로우"로 바꿀 수 있다.
  await createReviewWorkflow(request);

  // 빌더 → (자동으로 열린 저장 워크플로우) → 새 워크플로우(기본 캔버스).
  await page.goto("/workflows");
  await expect(page.getByRole("heading", { level: 1, name: "워크플로우 빌더" })).toBeVisible();
  const loader = page.getByRole("combobox", { name: "워크플로우 불러오기" });
  await expect(loader).not.toHaveValue("");
  await loader.selectOption("");
  await expect(page.getByText("새 워크플로우를 시작합니다.")).toBeVisible();
  await page.getByRole("textbox", { name: "워크플로우 이름" }).fill(workflowName);

  // 기본 노드 중 입력·Export만 남긴다.
  for (const kind of ["classifier", "branch", "kie", "required-checker", "merge"]) {
    const node = canvasNodeByKind(page, kind);
    await node.click();
    await page.keyboard.press("Delete");
    await expect(node).toHaveCount(0);
  }

  // 팔레트로 표 추출 노드를 추가하고 문서 입력 → 표 추출 → Export로 잇는다.
  await page.getByRole("complementary", { name: "워크플로우 모듈" }).getByRole("button", { name: "표 추출" }).click();
  const tableNode = canvasNodeByKind(page, "table");
  await expect(tableNode).toHaveCount(1);
  await expect(tableNode.locator(".wf-node-chip")).toHaveText("양식: 미선택");
  await connectNodes(page, canvasNodeByKind(page, "input"), tableNode);
  await connectNodes(page, tableNode, canvasNodeByKind(page, "export"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  // 실행 경로에 들어오면 양식 미선택이 오류가 되고 저장 버튼이 막힌다.
  await expect(tableNode.locator(".wf-node-badge[data-tone='danger']")).toBeVisible();
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();

  // Inspector: 양식 선택 → 표 2개 체크 → 하나만 남긴다(table_keys = ["items"]).
  await tableNode.click();
  const panel = page.getByRole("complementary", { name: "오른쪽 패널" });
  await panel.getByRole("combobox", { name: "표 양식 선택" }).selectOption(template.id);
  const summary = panel.getByRole("region", { name: "표 양식 요약" });
  await expect(summary).toContainText("표 2개 · 칼럼 4개");
  const keys = summary.getByRole("list", { name: "실행할 표" });
  await expect(keys.getByRole("checkbox")).toHaveCount(2);
  await expect(keys.getByRole("checkbox", { name: /품목 내역/ })).toBeChecked();
  await keys.getByRole("checkbox", { name: /비고 내역/ }).uncheck();
  await expect(keys.getByRole("checkbox", { name: /비고 내역/ })).not.toBeChecked();
  await expect(tableNode.locator(".wf-node-badge[data-tone='danger']")).toHaveCount(0);
  await expect(tableNode.locator(".wf-node-chip")).toContainText("표 1/2개");

  // 저장(서버가 표 노드를 검증한다: 실패하면 422).
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("워크플로우를 저장했습니다.")).toBeVisible();
  const workflows = (await (await request.get(`${BACKEND_BASE}/api/workflows`)).json()) as {
    id: string;
    name: string;
    definition: { nodes: { data: { kind: string; config?: Record<string, unknown> } }[] };
  }[];
  const saved = workflows.find((workflow) => workflow.name === workflowName);
  expect(saved, "saved workflow").toBeTruthy();
  const savedTable = saved!.definition.nodes.find((node) => node.data.kind === "table");
  expect(savedTable?.data.config).toMatchObject({ template_id: template.id, table_keys: ["items"] });

  // 보관함 문서 1개로 실행한다(이미 선택된 문서가 있으면 해제).
  await page.locator(".workflow-toolbar .library-picker-trigger").click();
  const picker = page.getByRole("dialog", { name: /실행할 문서 선택/ });
  await expect(picker.getByRole("heading", { name: "실행할 문서 선택" })).toBeVisible();
  const clear = picker.getByRole("button", { name: "선택 해제", exact: true });
  if (await clear.isVisible().catch(() => false)) await clear.click();
  await picker.getByRole("button", { name: new RegExp(`^${docName.replace(".", "\\.")} `) }).click();
  await picker.getByRole("button", { name: "선택 적용" }).click();
  await expect(page.getByRole("button", { name: "1개 문서 선택됨" })).toBeVisible();
  await page.getByRole("button", { name: "실행", exact: true }).click();
  await expect(page.getByText(/워크플로우 실행을 시작했습니다/)).toBeVisible();

  await panel.getByRole("tab", { name: /^실행/ }).click();
  const runs = page.getByRole("region", { name: "워크플로우 실행 현황" });
  const latestRun = runs.getByRole("button", { name: new RegExp(workflowName) }).first();
  await expect(latestRun).toContainText("1 / 1 처리", { timeout: 60_000 });
  await expect(latestRun).toContainText(/검토 필요|완료/);

  // 결과 화면 → 표 노드 요약(행·검토 칸·위반).
  await latestRun.getByRole("button", { name: "결과 보기" }).click();
  await expect(page).toHaveURL(/\/workflow-runs\//);
  const runId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop() ?? "");
  const run = (await (await request.get(`${BACKEND_BASE}/api/workflow-runs/${runId}`)).json()) as {
    items?: { result?: { node_results?: Record<string, { kind?: string; job_id?: string; tables?: { key: string; review_cells: number; violations: number }[] }> } }[];
  };
  const nodeResult = Object.values(run.items?.[0]?.result?.node_results ?? {}).find((entry) => entry.kind === "table");
  expect(nodeResult?.tables?.map((entry) => entry.key)).toEqual(["items"]);

  const tableResult = page.locator(".workflow-table-result");
  await expect(tableResult).toHaveCount(1);
  const row = tableResult.getByRole("table", { name: "표 추출 요약" }).locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.locator("td")).toHaveText([
    "품목 내역",
    "2",
    String(nodeResult!.tables![0].review_cells),
    String(nodeResult!.tables![0].violations)
  ]);

  // 결과 창 안에서도 표마다 읽기 전용 미리보기(앞 20행)를 보여 준다.
  await expect(tableResult.getByRole("table", { name: "품목 내역 미리보기" }).locator("tbody tr")).toHaveCount(2);

  // "검토 화면에서 열기" → 새 탭 /tables?job=… 결과 표 2행.
  const popupPromise = context.waitForEvent("page");
  await tableResult.getByRole("link", { name: "검토 화면에서 열기" }).click();
  const review = await popupPromise;
  await review.waitForLoadState();
  await expect(review).toHaveURL(new RegExp(`/tables\\?job=${nodeResult!.job_id}`));
  const grid = review.getByRole("table", { name: "품목 내역 결과" });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  await expect(grid.locator("tbody tr")).toHaveCount(2);
  await expect(review.getByRole("table", { name: "비고 내역 결과" })).toHaveCount(0);
  await review.close();

  // 저장된 워크플로우를 다시 불러오면 양식과 table_keys(배열 ↔ 쉼표 문자열)가 그대로다.
  await page.goto(`/workflows/${encodeURIComponent(saved!.id)}`);
  await expect(page.getByRole("textbox", { name: "워크플로우 이름" })).toHaveValue(workflowName);
  const reloadedNode = canvasNodeByKind(page, "table");
  await expect(reloadedNode.locator(".wf-node-chip")).toContainText("표 1/2개");
  // 오른쪽 패널 탭은 localStorage에 남는다(실행 탭에서 떠났음) → 속성 탭으로.
  await panel.getByRole("tab", { name: "속성" }).click();
  await reloadedNode.click();
  await expect(panel.getByRole("combobox", { name: "표 양식 선택" })).toHaveValue(template.id);
  const reloadedKeys = panel.getByRole("list", { name: "실행할 표" });
  await expect(reloadedKeys.getByRole("checkbox", { name: /품목 내역/ })).toBeChecked();
  await expect(reloadedKeys.getByRole("checkbox", { name: /비고 내역/ })).not.toBeChecked();

  // 다시 저장해도 배열 그대로(쉼표 문자열로 바뀌지 않는다).
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("워크플로우를 저장했습니다.")).toBeVisible();
  const resaved = (await (await request.get(`${BACKEND_BASE}/api/workflows/${saved!.id}`)).json()) as typeof saved;
  const resavedTable = resaved!.definition.nodes.find((node) => node.data.kind === "table");
  expect(resavedTable?.data.config).toMatchObject({ template_id: template.id, table_keys: ["items"] });
});
