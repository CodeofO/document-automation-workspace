import { useQuery } from "@tanstack/react-query";
import { GripVertical } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { isAbortError } from "../../../api/client";
import { fetchWorkflowDocument, workflowKeys } from "../api";
import {
  workflowClassFilterMatches,
  workflowClassFilterOptions,
  workflowResultFilterCounts,
  workflowResultFilterMatches
} from "../model/resultFilters";
import { workflowRunStatusClass } from "../model/runRules";
import type { WorkflowResultFilter, WorkflowRun } from "../types";
import { useResultPaneWidths } from "./useResultPaneWidths";
import { WorkflowDocumentPreview } from "./WorkflowDocumentPreview";
import { WorkflowItemInspector } from "./WorkflowItemInspector";
import { WorkflowRunHeader } from "./WorkflowRunHeader";
import { WorkflowRunRail } from "./WorkflowRunRail";

export type WorkflowRunResultActions = {
  onResume?: () => void;
  onPause?: () => void;
  onStartWaiting?: () => void;
  onDeleteQueueEntry?: () => void;
  onRetryFailed?: () => void;
  onDiscard?: () => void;
  onClose: () => void;
};

/** 결과 창 본문: 한 줄 헤더(상태·묶음 카운터·동작) + 목록 | 미리보기 | 결과 3열. */
export function WorkflowRunResults(props: WorkflowRunResultActions & { run: WorkflowRun; onDocumentError: (message: string) => void }) {
  const { run, onDocumentError } = props;
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<WorkflowResultFilter>("all");
  const [classFilter, setClassFilter] = useState("all");
  // 미리보기 페이지는 선택한 항목 기준이다. 항목이 페이지 단위면(page_number) 그 페이지에서 연다.
  const [pageState, setPageState] = useState({ itemId: "", page: 0 });
  const { workbenchStyle, startResize } = useResultPaneWidths();

  const statusScopedItems = useMemo(
    () => run.items.filter((item) => workflowResultFilterMatches(item, statusFilter)),
    [run.items, statusFilter]
  );
  const classScopedItems = useMemo(
    () => run.items.filter((item) => workflowClassFilterMatches(item, classFilter)),
    [run.items, classFilter]
  );
  const filteredItems = useMemo(
    () => run.items.filter((item) => workflowResultFilterMatches(item, statusFilter) && workflowClassFilterMatches(item, classFilter)),
    [classFilter, run.items, statusFilter]
  );
  const reviewItems = useMemo(() => run.items.filter((item) => item.status === "needs_review"), [run.items]);
  const filterCounts = useMemo(() => workflowResultFilterCounts(classScopedItems), [classScopedItems]);
  const classFilterOptions = useMemo(() => workflowClassFilterOptions(statusScopedItems), [statusScopedItems]);

  // 고른 분류가 목록에서 사라지면 "전체"로 되돌린다(렌더 중 상태 보정).
  if (classFilter !== "all" && !classFilterOptions.some((option) => option.value === classFilter)) setClassFilter("all");

  // 필터 밖으로 나간 선택은 필터 결과의 첫 항목으로 대신한다.
  const selectedItem =
    filteredItems.find((item) => item.id === selectedItemId) ?? filteredItems[0] ?? null;
  const documentId = selectedItem?.document_id ?? "";
  const itemPage = Math.max(0, (selectedItem?.page_number ?? 1) - 1);
  const activePage = selectedItem && pageState.itemId === selectedItem.id ? pageState.page : itemPage;

  const documentQuery = useQuery({
    queryKey: workflowKeys.document(documentId),
    queryFn: async ({ signal }) => {
      try {
        return await fetchWorkflowDocument(documentId, signal);
      } catch (error) {
        // 선택이 바뀌어 취소된 요청은 오류가 아니다.
        if (signal.aborted || isAbortError(error)) throw error;
        onDocumentError(error instanceof Error ? error.message : "문서 preview를 불러오지 못했습니다.");
        throw error;
      }
    },
    enabled: Boolean(documentId),
    retry: false
  });
  const document = documentId ? (documentQuery.data ?? null) : null;

  const goToNextReviewItem = useCallback(() => {
    if (!reviewItems.length) return;
    const currentIndex = reviewItems.findIndex((item) => item.id === selectedItem?.id);
    const nextItem = reviewItems[(currentIndex + 1) % reviewItems.length];
    setStatusFilter("review");
    setClassFilter("all");
    setSelectedItemId(nextItem.id);
  }, [reviewItems, selectedItem?.id]);

  return (
    <section className={`workflow-results ${workflowRunStatusClass(run)}`}>
      <WorkflowRunHeader {...props} reviewCount={reviewItems.length} onNextReview={goToNextReviewItem} />
      <progress className={`workflow-run-progress ${workflowRunStatusClass(run)}`} value={run.progress} max={1} />
      <div className="workflow-run-workbench workflow-run-workbench-resizable resize-scope" style={workbenchStyle}>
        <WorkflowRunRail
          run={run}
          items={filteredItems}
          selectedItem={selectedItem}
          statusFilter={statusFilter}
          classFilter={classFilter}
          filterCounts={filterCounts}
          classFilterOptions={classFilterOptions}
          onStatusFilter={setStatusFilter}
          onClassFilter={setClassFilter}
          onSelectItem={setSelectedItemId}
        />
        <button
          className="splitter workflow-result-splitter"
          type="button"
          title="목록 영역 너비 조절"
          aria-label="목록 영역 너비 조절"
          onPointerDown={(event) => startResize(event, "left")}
        >
          <GripVertical size={18} />
        </button>
        <WorkflowDocumentPreview
          key={`${documentId}:${activePage}`}
          document={document}
          loading={Boolean(documentId) && documentQuery.isLoading}
          activePage={activePage}
          onPage={(page) => setPageState({ itemId: selectedItem?.id ?? "", page })}
          item={selectedItem}
        />
        <button
          className="splitter workflow-result-splitter"
          type="button"
          title="결과 영역 너비 조절"
          aria-label="결과 영역 너비 조절"
          onPointerDown={(event) => startResize(event, "right")}
        >
          <GripVertical size={18} />
        </button>
        <WorkflowItemInspector key={selectedItem?.id ?? "none"} item={selectedItem} />
      </div>
    </section>
  );
}
