import { describe, expect, it } from "vitest";
import {
  formatDurationMs,
  mergeRunsList,
  resolveActiveRunId,
  sortWorkflowRunsByRegistration,
  upsertRunInList,
  workflowRunCanDeleteQueueEntry,
  workflowRunCanDiscard,
  workflowRunCanEnqueue,
  workflowRunCanPause,
  workflowRunCanResume,
  workflowRunCanRetryFailed,
  workflowRunCanStartWaiting,
  workflowRunDeleteQueueEntryLabel,
  workflowRunFinishedCount,
  workflowRunHeadline,
  workflowRunQueueMeta,
  workflowRunStatusClass,
  workflowRunStatusLabel,
  workflowRunTimeRange,
  workflowRunTimestamp
} from "./runRules";
import { makeItem, makeRun } from "./testFixtures";

describe("run 동작 가능 여부", () => {
  it("일시중단이고 업로드가 끝났으면 이어하기 가능", () => {
    const run = makeRun({ status: "paused", total_count: 1, items: [makeItem({ status: "paused" })] });
    expect(workflowRunCanResume(run)).toBe(true);
    expect(workflowRunCanResume({ ...run, uploaded_count: 0 })).toBe(false);
  });

  it("진행 중인 항목이 있으면 일시중단 가능, terminal·waiting·paused는 불가", () => {
    const run = makeRun({ status: "running", total_count: 1, uploaded_count: 1, running_count: 1, items: [makeItem()] });
    expect(workflowRunCanPause(run)).toBe(true);
    expect(workflowRunCanPause({ ...run, running_count: 0, queued_count: 0, preprocessing_count: 0 })).toBe(false);
    expect(workflowRunCanPause({ ...run, status: "completed" })).toBe(false);
    expect(workflowRunCanPause({ ...run, status: "waiting" })).toBe(false);
    expect(workflowRunCanPause({ ...run, status: "paused" })).toBe(false);
  });

  it("실패가 있고 처리 중 항목이 없을 때만 실패 재시도", () => {
    const run = makeRun({ status: "completed_with_errors", failed_count: 1, items: [makeItem({ status: "failed" })] });
    expect(workflowRunCanRetryFailed(run)).toBe(true);
    expect(workflowRunCanRetryFailed({ ...run, items: [makeItem({ status: "running" })] })).toBe(false);
    expect(workflowRunCanRetryFailed({ ...run, status: "canceled" })).toBe(false);
  });

  it("업로드된 문서가 있으면 예약 가능", () => {
    const run = makeRun({ status: "completed", total_count: 1, items: [makeItem()] });
    expect(workflowRunCanEnqueue(run)).toBe(true);
    expect(workflowRunCanEnqueue({ ...run, status: "failed" })).toBe(false);
    expect(workflowRunCanEnqueue({ ...run, items: [] })).toBe(false);
  });

  it("중단은 끝나지 않은 run만", () => {
    expect(workflowRunCanDiscard(makeRun({ status: "running" }))).toBe(true);
    expect(workflowRunCanDiscard(makeRun({ status: "needs_review" }))).toBe(false);
    expect(workflowRunCanDiscard(makeRun({ status: "waiting" }))).toBe(false);
  });

  it("예약 run의 대기열 삭제 라벨", () => {
    const queued = makeRun({ queued_from_run_id: "src", status: "waiting" });
    expect(workflowRunCanDeleteQueueEntry(queued)).toBe(true);
    expect(workflowRunDeleteQueueEntryLabel(queued)).toBe("대기 삭제");
    expect(workflowRunDeleteQueueEntryLabel({ ...queued, status: "running" })).toBe("중단 후 삭제");
    expect(workflowRunDeleteQueueEntryLabel({ ...queued, status: "canceled" })).toBe("목록 삭제");
    expect(workflowRunCanDeleteQueueEntry({ ...queued, status: "completed" })).toBe(false);
    expect(workflowRunQueueMeta(queued)).toBe(" · 실행 예약");
  });
});

describe("대기열", () => {
  it("그룹에서 가장 앞선 대기 run만 바로 실행할 수 있다", () => {
    const first = makeRun({ id: "a", status: "waiting", workflow_run_group_id: "g", queue_order: 1 });
    const second = makeRun({ id: "b", status: "waiting", workflow_run_group_id: "g", queue_order: 2 });
    expect(workflowRunCanStartWaiting(first, [first, second])).toBe(true);
    expect(workflowRunCanStartWaiting(second, [first, second])).toBe(false);
    expect(workflowRunCanStartWaiting(second)).toBe(true);
  });

  it("앞선 순서의 run이 아직 진행 중이면 바로 실행 불가", () => {
    const running = makeRun({ id: "a", status: "running", workflow_run_group_id: "g", queue_order: 0 });
    const waiting = makeRun({ id: "b", status: "waiting", workflow_run_group_id: "g", queue_order: 1 });
    expect(workflowRunCanStartWaiting(waiting, [running, waiting])).toBe(false);
    expect(workflowRunCanStartWaiting(waiting, [{ ...running, status: "completed" }, waiting])).toBe(true);
  });
});

describe("목록 정렬·병합", () => {
  const older = makeRun({ id: "old", created_at: "2026-10-14T00:00:00" });
  const newer = makeRun({ id: "new", created_at: "2026-10-15T00:00:00Z" });

  it("타임존 없는 백엔드 시각을 UTC로 읽는다", () => {
    expect(workflowRunTimestamp("2026-10-15T00:00:00")).toBe(Date.parse("2026-10-15T00:00:00Z"));
    expect(workflowRunTimestamp(null)).toBe(0);
  });

  it("최신 등록순으로 정렬한다", () => {
    expect(sortWorkflowRunsByRegistration([older, newer]).map((run) => run.id)).toEqual(["new", "old"]);
  });

  it("목록 응답에 items가 없으면 기존 items를 유지한다", () => {
    const withItems = { ...older, items: [makeItem()] };
    const merged = mergeRunsList([{ ...older, status: "completed" }], [withItems]);
    expect(merged[0].status).toBe("completed");
    expect(merged[0].items).toHaveLength(1);
  });

  it("upsert는 교체하고 개수를 제한한다", () => {
    const list = upsertRunInList([older], { ...newer }, 1);
    expect(list.map((run) => run.id)).toEqual(["new"]);
    expect(upsertRunInList([older, newer], { ...older, status: "failed" }).find((run) => run.id === "old")?.status).toBe("failed");
  });
});

describe("선택 run 결정", () => {
  const done = makeRun({ id: "done", status: "completed" });
  const live = makeRun({ id: "live", status: "running" });

  it("목록이 비면 선택 없음", () => {
    expect(resolveActiveRunId([], "x", false)).toBe("");
  });

  it("진행 중 run을 따라간다(수동 선택이 아니면)", () => {
    expect(resolveActiveRunId([live, done], "done", false)).toBe("live");
  });

  it("수동으로 고른 살아 있는 run은 유지한다", () => {
    const other = makeRun({ id: "other", status: "paused" });
    expect(resolveActiveRunId([live, other], "other", true)).toBe("other");
    expect(resolveActiveRunId([live, done], "done", true)).toBe("live");
  });

  it("선택이 없으면 첫 run", () => {
    expect(resolveActiveRunId([done], "", false)).toBe("done");
    expect(resolveActiveRunId([done], "done", true)).toBe("done");
  });
});

describe("표시", () => {
  it("상태 라벨과 헤드라인", () => {
    expect(workflowRunStatusLabel(makeRun({ status: "needs_review" }))).toBe("검토 필요");
    expect(workflowRunStatusLabel(makeRun({ status: "completed" }))).toBe("완료");
    expect(workflowRunHeadline(makeRun({ status: "completed" }))).toBe("작업 완료");
    expect(workflowRunHeadline(makeRun({ status: "running", uploaded_count: 0, total_count: 2 }))).toBe("문서 업로드 중");
    expect(workflowRunHeadline(makeRun({ status: "running", uploaded_count: 2, total_count: 2 }))).toBe("작업 진행 중");
    expect(workflowRunStatusClass(makeRun({ status: "completed_with_errors" }))).toBe("status-completed-with-errors");
  });

  it("처리 수는 전체를 넘지 않는다", () => {
    expect(workflowRunFinishedCount(makeRun({ total_count: 3, completed_count: 2, failed_count: 1, needs_review_count: 1 }))).toBe(3);
  });

  it("헤더 시간 범위는 시:분만 보이고 전체 시각은 title에 둔다", () => {
    const finished = workflowRunTimeRange(
      makeRun({ status: "completed", started_at: "2026-10-19T01:53:00Z", completed_at: "2026-10-19T01:55:00Z" })
    );
    expect(finished.label).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
    expect(finished.title).toContain("시작");
    expect(finished.title).toContain("종료");
    const live = workflowRunTimeRange(makeRun({ status: "running", started_at: "2026-10-19T01:53:00Z", uploaded_count: 2 }));
    expect(live.label).toMatch(/^\d{2}:\d{2}–진행 중$/);
    expect(workflowRunTimeRange(makeRun({ status: "waiting" })).label).toBe("대기 중");
  });

  it("소요 시간", () => {
    expect(formatDurationMs(null)).toBe("-");
    expect(formatDurationMs(500)).toBe("500ms");
    expect(formatDurationMs(1500)).toBe("1.5초");
    expect(formatDurationMs(65_000)).toBe("1분 5초");
  });
});
