// 표 추출 단독 실행·검토 화면(설계 §7-3). 뼈대(spec B-1): PageHeader → InlineAlert → JobStatusBar → SplitPane.
// 왼쪽: 페이지 목록(검토 필요/위반 필터) + 원본 이미지(표 영역 상자, 선택 행 띠).
// 오른쪽: 양식 카드 → 결과 카드(표 탭 → 결과 격자, 칸 수정·행 추가/삭제, [수정 저장][검토 완료]).
// 주소: /tables?batch=<배치 id> | ?job=<job id>(워크플로우에서 열기) | ?template=<양식 id>
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, FilePlus2, PencilLine, Play, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { apiUrl, isAbortError, toFriendlyError } from "../../api/client";
import { tableTemplatePath } from "../../app/routes";
import { DocumentViewer } from "../../components/document/DocumentViewer";
import {
  Button,
  Card,
  EmptyState,
  ExportMenu,
  FilterChips,
  InlineAlert,
  JobStatusBar,
  ModulePage,
  PageHeader,
  ResponsiveTabs,
  SaveIndicator,
  SplitPane,
  StatusBadge,
  useConfirm,
  type ExportMenuOption
} from "../../components/ui";
import { summarizeDocuments } from "../../lib/files";
import { documentLabel } from "../../lib/format";
import { isActiveStatus, isTerminalStatus, statusLabel } from "../../lib/status";
import { readStorage, writeStorage } from "../../lib/storage";
import {
  DocumentInput,
  LibraryDocumentSelectionPreview,
  useDocumentDetail,
  useHandedOffDocuments,
  type LibraryDocument
} from "../library";
import { BatchItemRail, batchCanDiscard, batchCanResume } from "../module-batch";
import { ExportJobHistory, jobExportOptions } from "../export-jobs";
import { useUploadLimits } from "../settings";
import {
  createTableBatch,
  createTableJob,
  discardTableBatch,
  fetchTableJob,
  patchTableResult,
  resumeTableBatch,
  tableJobExportUrl,
  tableKeys,
  useActiveTableBatch,
  useTableJob,
  useTableTemplates,
  waitForTableJob,
  writeTableBatchCache,
  writeTableJobResult
} from "./api";
import { TableRegionOverlay } from "./components/TableRegionOverlay";
import { TableResultTabs } from "./components/TableResultTabs";
import { rowBand } from "./model/regions";
import {
  addPendingRow,
  buildResultPatch,
  displayRows,
  effectiveTables,
  emptyPending,
  pendingChangeCount,
  pendingIsEmpty,
  resultHasViolations,
  resultStats,
  setPendingCell,
  togglePendingDelete,
  type PageFilter,
  type PendingEdits
} from "./model/results";
import { templateLabel, templateSummary } from "./model/template";
import type {
  TableExtractionBatch,
  TableExtractionBatchItem,
  TableExtractionJob,
  TableExtractionResult
} from "./types";

type Notice = { tone: "info" | "success" | "warning" | "danger"; text: string };

const TEMPLATE_STORAGE_KEY = "table_extraction_template_v1";

function nextReviewItem(items: TableExtractionBatchItem[], currentId: string | null) {
  const reviewItems = items.filter((item) => item.status === "needs_review");
  if (!reviewItems.length) return null;
  const index = reviewItems.findIndex((item) => item.id === currentId);
  return reviewItems[(index + 1) % reviewItems.length];
}

function batchFinished(batch: TableExtractionBatch) {
  // completed_count에는 검토 필요로 끝난 항목도 들어 있다.
  return batch.completed_count + batch.failed_count + batch.canceled_count;
}

export function TableExtractionPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { uploadMaxBatchFiles, uploadChunkFiles } = useUploadLimits();
  const handedOff = useHandedOffDocuments("table");
  const [params, setParams] = useSearchParams();
  const batchId = params.get("batch");
  const routeJobId = params.get("job");
  const routeTemplateId = params.get("template");

  const templatesQuery = useTableTemplates();
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const [chosenTemplateId, setChosenTemplateId] = useState<string | null>(
    () => routeTemplateId ?? readStorage(TEMPLATE_STORAGE_KEY)
  );
  const [selectedDocuments, setSelectedDocuments] = useState<LibraryDocument[]>(handedOff);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [pageFilter, setPageFilter] = useState<PageFilter>("all");
  const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: "", page: 0 });
  const [activeTableKey, setActiveTableKey] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [showRegions, setShowRegions] = useState(true);
  const [pending, setPending] = useState<PendingEdits | null>(null);
  const [saving, setSaving] = useState<"save" | "review" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(() =>
    handedOff.length ? { tone: "info", text: `${handedOff.length.toLocaleString()}개 보관 문서를 선택했습니다.` } : null
  );
  const [awaitedJobId, setAwaitedJobId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return () => controller.abort();
  }, []);

  const { batch, error: batchError } = useActiveTableBatch(routeJobId ? null : batchId);

  // 배치 항목 필터. "위반"은 검토 필요 항목의 결과를 읽어야 알 수 있어 그 필터를 고를 때만 읽는다.
  const reviewItems = useMemo(
    () => (batch?.items ?? []).filter((item) => item.status === "needs_review"),
    [batch?.items]
  );
  const violationQueries = useQueries({
    queries: reviewItems.map((item) => ({
      queryKey: tableKeys.job(item.job_id),
      queryFn: () => fetchTableJob(item.job_id),
      enabled: pageFilter === "violation",
      staleTime: 30_000
    }))
  });
  const violationJobIds = new Set(
    violationQueries
      .map((query) => query.data)
      .filter((job): job is TableExtractionJob => Boolean(job && resultHasViolations(job.result)))
      .map((job) => job.job_id)
  );
  const violationsLoaded = pageFilter === "violation" && violationQueries.every((query) => query.isFetched);
  const railItems = (batch?.items ?? []).filter((item) =>
    pageFilter === "review"
      ? item.status === "needs_review"
      : pageFilter === "violation"
        ? violationJobIds.has(item.job_id)
        : true
  );

  const activeItem = batch?.items.find((item) => item.id === activeItemId) ?? railItems[0] ?? batch?.items[0] ?? null;
  const jobId = routeJobId ?? activeItem?.job_id ?? null;
  const jobQuery = useTableJob(jobId, Boolean(jobId) && awaitedJobId === jobId);
  const job = jobId ? (jobQuery.data ?? null) : null;
  const result: TableExtractionResult | null = job?.result ?? null;
  const tables = effectiveTables(result);
  const viewDocumentId =
    job?.document_id ??
    activeItem?.document_id ??
    (selectedDocuments.length === 1 ? selectedDocuments[0].document_id : null);
  const documentQuery = useDocumentDetail(viewDocumentId);
  const document = viewDocumentId ? (documentQuery.data ?? null) : null;
  const viewPageNumber = job?.page_number ?? activeItem?.page_number ?? null;
  const pageKey = `${viewDocumentId ?? ""}:${jobId ?? ""}`;
  const activePage = pageState.key === pageKey ? pageState.page : Math.max(0, (viewPageNumber ?? 1) - 1);

  const templateId =
    routeJobId || batchId ? (job?.template_id ?? batch?.template_id ?? chosenTemplateId) : chosenTemplateId;
  const selectedTemplate = templates.find((item) => item.id === templateId) ?? null;
  // 고른 양식이 없으면 보고 있는 결과(배치·job)의 양식을 다시 실행 대상으로 둔다.
  const runTemplateId = chosenTemplateId ?? job?.template_id ?? batch?.template_id ?? null;
  const runTemplate = templates.find((item) => item.id === runTemplateId) ?? null;
  // 결과에 쓴 정의(실행 시점 사본)가 있으면 그것으로 영역·순서를 그린다.
  const definitionTables = job?.definition_snapshot?.tables ?? selectedTemplate?.tables ?? [];
  const orderOf = (key: string) =>
    Math.max(
      0,
      definitionTables.findIndex((spec) => spec.key === key)
    );

  const dirty = Boolean(pending && result && pending.resultId === result.id && !pendingIsEmpty(pending));
  const activePending = pending && result && pending.resultId === result.id ? pending : null;
  const activeTable = tables.find((table) => table.table_key === activeTableKey) ?? tables[0] ?? null;
  const activeKey = activeTable?.table_key ?? null;

  const band =
    activeTable && selectedRowId
      ? rowBand(
          activeTable.region_used,
          displayRows(activeTable, activePending).map((item) => item.row),
          selectedRowId
        )
      : null;

  const onJobPage = !viewPageNumber || activePage + 1 === viewPageNumber;
  const overlay =
    job && onJobPage ? (
      <TableRegionOverlay
        regions={definitionTables.map((spec, index) => ({
          key: spec.key,
          name: spec.name,
          order: index,
          region: spec.region
        }))}
        activeKey={activeKey}
        band={band}
        showRegions={showRegions}
      />
    ) : null;

  function notify(text: string, tone: Notice["tone"] = "info") {
    setNotice({ tone, text });
  }

  async function runTask(label: string, task: () => Promise<void>) {
    setBusy(label);
    setNotice(null);
    try {
      await task();
    } catch (exc) {
      if (!isAbortError(exc)) notify(toFriendlyError(exc), "danger");
    } finally {
      setBusy(null);
    }
  }

  async function confirmDiscardEdits(): Promise<boolean> {
    if (!dirty) return true;
    const accepted = await confirm({
      title: "저장하지 않은 수정",
      message: "표 수정 내용을 저장하지 않았습니다. 버리고 이동할까요?",
      confirmLabel: "버리고 이동",
      tone: "danger"
    });
    if (accepted) setPending(null);
    return accepted;
  }

  function resetSelection() {
    setSelectedRowId(null);
    setActiveTableKey(null);
  }

  function chooseTemplate(id: string) {
    setChosenTemplateId(id || null);
    if (id) writeStorage(TEMPLATE_STORAGE_KEY, id);
  }

  async function selectDocuments(documents: LibraryDocument[]) {
    if (!(await confirmDiscardEdits())) return;
    setSelectedDocuments(documents);
    if (documents.length) {
      setParams({}, { replace: true });
      setActiveItemId(null);
      resetSelection();
      notify(`${documents.length.toLocaleString()}개 보관 문서를 선택했습니다.`);
    } else setNotice(null);
  }

  function run() {
    if (!runTemplate) {
      notify("실행할 표 양식을 고르세요. 없으면 [새 양식]으로 만드세요.", "warning");
      return;
    }
    if (!runTemplate.tables.length) {
      notify("양식에 표가 없습니다. 양식 편집에서 표를 추가하세요.", "warning");
      return;
    }
    const rerun =
      !selectedDocuments.length && job ? { documentId: job.document_id, pageNumber: job.page_number ?? 1 } : null;
    if (!selectedDocuments.length && !rerun) {
      notify("실행할 문서를 추가하거나 보관함에서 선택하세요.", "warning");
      return;
    }
    void runTask(rerun ? "이 페이지를 다시 읽는 중" : "배치 작업을 만드는 중", async () => {
      if (!(await confirmDiscardEdits())) return;
      if (rerun) {
        const created = await createTableJob({
          document_id: rerun.documentId,
          page_number: rerun.pageNumber,
          template_id: runTemplate.id
        });
        queryClient.setQueryData(tableKeys.job(created.job_id), created);
        resetSelection();
        setParams({ job: created.job_id }, { replace: true });
        setAwaitedJobId(created.job_id);
        try {
          const done = await waitForTableJob(created.job_id, {
            signal: abortRef.current?.signal,
            onProgress: (progress) => queryClient.setQueryData(tableKeys.job(created.job_id), progress)
          });
          queryClient.setQueryData(tableKeys.job(created.job_id), done);
          notify(
            done.status === "failed" ? done.error_message || "실행에 실패했습니다." : "표를 다시 읽었습니다.",
            done.status === "failed" ? "danger" : "success"
          );
        } finally {
          setAwaitedJobId(null);
        }
        return;
      }
      const created = await createTableBatch(
        runTemplate.id,
        selectedDocuments.map((item) => item.document_id)
      );
      writeTableBatchCache(queryClient, created);
      setSelectedDocuments([]);
      setActiveItemId(created.items[0]?.id ?? null);
      setPageFilter("all");
      resetSelection();
      setParams({ batch: created.id }, { replace: true });
      notify(
        `${selectedDocuments.length.toLocaleString()}개 문서의 표 추출을 시작했습니다. 페이지마다 한 항목으로 처리하며, 변환 중인 문서는 준비되면 페이지가 추가됩니다.`,
        "success"
      );
    });
  }

  async function openItem(itemId: string) {
    if (itemId === activeItem?.id) return;
    if (!(await confirmDiscardEdits())) return;
    setActiveItemId(itemId);
    resetSelection();
  }

  async function stopBatch(target: TableExtractionBatch) {
    const accepted = await confirm({
      title: "배치 중단",
      message: "남은 처리를 멈춥니다. 이미 끝난 결과와 배치 기록은 남습니다.",
      confirmLabel: "중단",
      tone: "danger"
    });
    if (!accepted) return;
    await runTask("배치를 중단하는 중", async () => {
      writeTableBatchCache(queryClient, await discardTableBatch(target.id));
      notify("배치를 중단했습니다. 끝난 결과와 기록은 남아 있습니다.");
    });
  }

  function resumeBatch(target: TableExtractionBatch) {
    void runTask("배치를 다시 시작하는 중", async () => {
      writeTableBatchCache(queryClient, await resumeTableBatch(target.id));
      notify("등록된 문서 기준으로 배치 처리를 계속합니다.");
    });
  }

  async function saveResult(reviewed: boolean) {
    if (!result || !job) return;
    const patch = buildResultPatch(activePending ?? emptyPending(result.id), reviewed ? { reviewed: true } : {});
    if (!reviewed && !Object.keys(patch).length) return;
    setSaving(reviewed ? "review" : "save");
    try {
      const saved = await patchTableResult(result.id, patch);
      writeTableJobResult(queryClient, job.job_id, saved);
      setPending(null);
      notify(reviewed ? "검토 완료로 표시했습니다." : "수정한 표를 저장했습니다.", "success");
    } catch (exc) {
      notify(toFriendlyError(exc), "danger");
    } finally {
      setSaving(null);
    }
  }

  function updatePending(updater: (current: PendingEdits) => PendingEdits) {
    if (!result) return;
    setPending((current) => updater(current && current.resultId === result.id ? current : emptyPending(result.id)));
  }

  // ---- 화면 ----

  const viewLabel = document ? documentLabel(document.filename, viewPageNumber) : null;
  const headerTitle = viewLabel
    ? viewLabel
    : selectedDocuments.length === 1
      ? selectedDocuments[0].filename
      : selectedDocuments.length
        ? summarizeDocuments(selectedDocuments)
        : batch
          ? `배치 · ${batch.total_count.toLocaleString()}개 페이지`
          : "문서를 선택하세요";
  const runCount = selectedDocuments.length || (job ? 1 : 0);
  const steps = [
    { label: "문서", active: !runCount && !job, done: Boolean(runCount || job || batch) },
    { label: "양식", active: Boolean(runCount) && !runTemplate, done: Boolean(runTemplate) },
    { label: "실행", active: Boolean(busy) || isActiveStatus(batch?.status), done: Boolean(job || batch) },
    { label: "검토", active: Boolean(result), done: Boolean(result?.reviewed) }
  ];
  const loadError =
    templatesQuery.error ??
    batchError ??
    (jobId ? jobQuery.error : null) ??
    (viewDocumentId ? documentQuery.error : null);
  const stats = resultStats(tables);

  // 단건(이 페이지) export: 서버 파일(xlsx/csv zip/json, 사람 수정본 우선).
  const singleExportOptions: ExportMenuOption[] =
    result && job
      ? (["json", "csv", "xlsx"] as const).map((format) => ({
          format,
          label: format === "csv" ? "CSV (zip)" : undefined,
          href: apiUrl(tableJobExportUrl(job.job_id, format))
        }))
      : [];

  const mainContent =
    document && (job || activeItem || selectedDocuments.length === 1) ? (
      <DocumentViewer
        document={document}
        activePage={activePage}
        onPage={(page) => setPageState({ key: pageKey, page })}
        eyebrow={job ? "결과 문서" : "미리보기"}
        title={viewLabel ?? document.filename}
        showRegions={showRegions}
        overlay={overlay}
        toolbarExtra={
          job ? (
            <Button
              size="sm"
              variant="ghost"
              className={showRegions ? "active-tool" : ""}
              aria-pressed={showRegions}
              onClick={() => setShowRegions(!showRegions)}
            >
              표 영역
            </Button>
          ) : undefined
        }
        onClear={job || activeItem ? undefined : () => void selectDocuments([])}
      />
    ) : selectedDocuments.length > 1 ? (
      <LibraryDocumentSelectionPreview documents={selectedDocuments} onClear={() => void selectDocuments([])} />
    ) : viewDocumentId ? (
      <EmptyState title="문서를 불러오는 중입니다." />
    ) : (
      <DocumentInput
        variant="zone"
        maxFiles={uploadMaxBatchFiles}
        chunkSize={uploadChunkFiles}
        selectedDocuments={selectedDocuments}
        onReady={(documents) => void selectDocuments(documents)}
        onNotice={(next) => setNotice(next)}
        description="장부·일지 이미지나 PDF를 올리면 보관함에 저장한 뒤 페이지마다 양식의 표를 행 단위로 읽습니다."
      />
    );

  const templateCard = (
    <Card
      className="table-run-template-card"
      eyebrow="표 양식"
      title={runTemplate ? templateLabel(runTemplate) : "양식을 고르세요"}
      collapsed={Boolean(result) && Boolean(runTemplate)}
      summary={runTemplate ? templateSummary(runTemplate) : undefined}
      actions={
        <>
          <Button
            size="sm"
            icon={<PencilLine size={14} />}
            disabled={!runTemplate}
            onClick={() => runTemplate && navigate(tableTemplatePath(runTemplate.id))}
          >
            양식 편집
          </Button>
          <Button size="sm" icon={<FilePlus2 size={14} />} onClick={() => navigate(tableTemplatePath())}>
            새 양식
          </Button>
        </>
      }
    >
      <label className="ui-field">
        <span>실행할 양식</span>
        <select
          aria-label="실행할 표 양식"
          value={runTemplate?.id ?? ""}
          onChange={(event) => chooseTemplate(event.target.value)}
        >
          <option value="">{templates.length ? "양식 선택" : "저장된 양식이 없습니다"}</option>
          {templates.map((item) => (
            <option key={item.id} value={item.id}>
              {templateLabel(item)} · {templateSummary(item)}
            </option>
          ))}
        </select>
      </label>
      {runTemplate && (
        <ul className="table-template-summary" aria-label="양식의 표">
          {runTemplate.tables.map((spec, index) => (
            <li key={spec.key} style={{ "--region-color": `var(--table-region-${(index % 8) + 1})` } as CSSProperties}>
              <span className="table-region-swatch" aria-hidden />
              <strong>{spec.name}</strong>
              <span>
                칼럼 {spec.columns.length}개{spec.region ? "" : " · 영역 없음(페이지 전체)"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!templates.length && templatesQuery.isSuccess && (
        <p className="ui-field-note">먼저 [새 양식]에서 샘플 이미지에 표 영역을 그리고 칼럼을 정의하세요.</p>
      )}
    </Card>
  );

  const resultCard = (
    <Card
      className="table-result-card"
      fill
      eyebrow="결과"
      title={
        job ? (
          <span className="table-result-title">
            {statusLabel(job.status)}
            {result?.reviewed && <StatusBadge status="completed" label="검토 완료" />}
          </span>
        ) : (
          "실행 대기"
        )
      }
      actions={
        dirty ? (
          <SaveIndicator state="dirty" label={`수정 ${pendingChangeCount(activePending)}건 · 저장 전`} />
        ) : result ? (
          <span className="table-result-counts">
            {stats.rows.toLocaleString()}행 · 검토 칸 {stats.reviewCells.toLocaleString()} · 위반{" "}
            {stats.violations.toLocaleString()}
          </span>
        ) : undefined
      }
      footer={
        result ? (
          <>
            <ExportMenu compact align="right" options={singleExportOptions} title="이 페이지 결과만 내보내기" />
            <Button
              size="sm"
              variant={dirty ? "primary" : "secondary"}
              icon={<Save size={14} />}
              disabled={!dirty || Boolean(saving)}
              loading={saving === "save"}
              onClick={() => void saveResult(false)}
            >
              수정 저장
            </Button>
            <Button
              size="sm"
              variant={dirty ? "secondary" : "primary"}
              icon={<CheckCheck size={14} />}
              disabled={Boolean(saving)}
              loading={saving === "review"}
              title={dirty ? "수정을 저장하고 검토 완료로 표시합니다" : "검토 완료로 표시합니다"}
              onClick={() => void saveResult(true)}
            >
              검토 완료
            </Button>
          </>
        ) : undefined
      }
    >
      {viewLabel && job && <small className="ui-card-source">{viewLabel}</small>}
      {job && !isTerminalStatus(job.status) && (
        <InlineAlert busy>표를 읽는 중입니다. 양식의 표마다 따로 읽습니다.</InlineAlert>
      )}
      {job?.error_message && <InlineAlert tone="danger">{job.error_message}</InlineAlert>}
      {result && tables.length ? (
        <TableResultTabs
          tables={tables}
          orderOf={orderOf}
          activeKey={activeKey}
          onActiveKey={(key) => {
            setActiveTableKey(key);
            setSelectedRowId(null);
          }}
          pending={activePending}
          selectedRowId={selectedRowId}
          onSelectRow={setSelectedRowId}
          editable
          onEditCell={(tableKey, rowId, column, value, original) =>
            updatePending((current) => setPendingCell(current, tableKey, rowId, column, value, original))
          }
          onAddRow={(tableKey, afterRowId) => updatePending((current) => addPendingRow(current, tableKey, afterRowId))}
          onToggleDelete={(tableKey, rowId) =>
            updatePending((current) => togglePendingDelete(current, tableKey, rowId))
          }
        />
      ) : !job ? (
        <EmptyState compact title="아직 결과가 없습니다.">
          문서와 양식을 고르고 [실행]을 누르면 페이지마다 표를 행 단위로 읽습니다.
        </EmptyState>
      ) : null}
    </Card>
  );

  const counters = batch
    ? {
        total: batch.total_count,
        completed: batch.completed_count,
        needsReview: batch.needs_review_count,
        failed: batch.failed_count
      }
    : null;

  return (
    <ModulePage
      module="tables"
      header={
        <PageHeader
          eyebrow="표 추출"
          title={headerTitle}
          description="장부·일지처럼 행이 여러 개인 표를 양식의 표 영역마다 행 단위 데이터로 옮깁니다."
          steps={steps}
          collapseActions
          actions={
            <>
              <DocumentInput
                variant="button"
                maxFiles={uploadMaxBatchFiles}
                chunkSize={uploadChunkFiles}
                selectedDocuments={selectedDocuments}
                disabled={Boolean(busy)}
                onReady={(documents) => void selectDocuments(documents)}
                onNotice={(next) => setNotice(next)}
              />
              <Button variant="primary" icon={<Play size={16} />} disabled={Boolean(busy) || !runCount} onClick={run}>
                실행
              </Button>
            </>
          }
        />
      }
      alerts={
        busy || notice || loadError ? (
          <>
            {busy && <InlineAlert busy>{busy}</InlineAlert>}
            {notice && (
              <InlineAlert tone={notice.tone} onDismiss={() => setNotice(null)}>
                {notice.text}
              </InlineAlert>
            )}
            {loadError && <InlineAlert tone="danger">{toFriendlyError(loadError)}</InlineAlert>}
          </>
        ) : null
      }
      statusBar={
        batch && counters ? (
          <JobStatusBar
            eyebrow="배치"
            status={batch.status}
            progress={batch.progress}
            processed={batchFinished(batch)}
            total={batch.total_count}
            counters={counters}
            onNextReview={() => {
              const next = nextReviewItem(batch.items, activeItem?.id ?? null);
              if (next) void openItem(next.id);
            }}
            exportOptions={jobExportOptions("table_extraction_batch", batch.id)}
            exportFooter={<ExportJobHistory ownerType="table_extraction_batch" ownerId={batch.id} compact limit={3} />}
            onResume={batchCanResume(batch) ? () => resumeBatch(batch) : undefined}
            onStop={batchCanDiscard(batch) ? () => void stopBatch(batch) : undefined}
          />
        ) : null
      }
    >
      <SplitPane
        leftLabel="문서"
        rightLabel="표 양식과 결과"
        left={
          <div className={batch && !routeJobId ? "ui-document-area with-rail" : "ui-document-area"}>
            {batch && !routeJobId && (
              <div className="table-page-rail">
                <FilterChips
                  label="페이지 필터"
                  value={pageFilter}
                  onChange={setPageFilter}
                  options={[
                    { value: "all", label: "전체", count: batch.items.length },
                    { value: "review", label: "검토 필요", count: reviewItems.length },
                    { value: "violation", label: "위반", count: violationsLoaded ? violationJobIds.size : undefined }
                  ]}
                />
                {railItems.length ? (
                  <BatchItemRail
                    label="페이지"
                    items={railItems.map((item) => ({
                      ...item,
                      label: documentLabel(item.filename, item.page_number)
                    }))}
                    activeItemId={activeItem?.id ?? null}
                    onOpen={(itemId) => void openItem(itemId)}
                  />
                ) : (
                  <EmptyState
                    compact
                    title={
                      pageFilter === "violation" && !violationsLoaded ? "결과를 확인하는 중" : "해당 페이지가 없습니다."
                    }
                  />
                )}
              </div>
            )}
            <div className="ui-document-main">{mainContent}</div>
          </div>
        }
        right={
          <ResponsiveTabs
            label="양식과 결과"
            defaultTab={result ? "result" : "template"}
            tabs={[
              { id: "template", label: "양식", content: templateCard },
              { id: "result", label: "결과", content: resultCard }
            ]}
          />
        }
      />
    </ModulePage>
  );
}
