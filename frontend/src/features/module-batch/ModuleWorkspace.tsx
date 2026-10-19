// 분류·필수항목 공용 BatchModule 화면. 모듈별 차이는 config(ModuleKindConfig)로 받는다.
// 뼈대(spec B-1): PageHeader → InlineAlert → JobStatusBar → SplitPane[문서(Rail+뷰어) | 정의 카드 → 결과 카드].
import { useQueryClient } from "@tanstack/react-query";
import { Library, Play, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isAbortError, toFriendlyError } from "../../api/client";
import { DocumentViewer } from "../../components/document/DocumentViewer";
import {
  Button,
  Card,
  DefinitionListDrawer,
  EmptyState,
  ExportMenu,
  InlineAlert,
  JobStatusBar,
  ModulePage,
  PageHeader,
  ResponsiveTabs,
  SaveIndicator,
  SplitPane,
  useConfirm,
  type ExportMenuOption
} from "../../components/ui";
import { downloadCsv, downloadJson, safeFilename } from "../../lib/download";
import { summarizeDocuments } from "../../lib/files";
import { documentLabel } from "../../lib/format";
import { isActiveStatus, statusLabel } from "../../lib/status";
import { ExportJobHistory, jobExportOptions } from "../export-jobs";
import { DocumentInput, LibraryDocumentSelectionPreview, useDocumentDetail, type LibraryDocument } from "../library";
import {
  createBatchFromDocuments,
  createModuleJob,
  discardBatch,
  moduleKeys,
  patchModuleResult,
  resumeBatch,
  useActiveModuleBatch,
  useModuleJob,
  waitForModuleJob,
  writeBatchCache
} from "./api";
import { batchCanDiscard, batchCanResume } from "./batchRules";
import { BatchItemRail } from "./BatchItemRail";
import { batchItemLabel, batchRailCounts, initialPageIndex, nextReviewItem } from "./model";
import type {
  ModuleActionContext,
  ModuleBatch,
  ModuleDefinition,
  ModuleJob,
  ModuleKindConfig,
  Notice,
  NoticeTone
} from "./types";
import { useDefinitionDraft } from "./useDefinitionDraft";

export type ModuleWorkspaceProps<TDef extends ModuleDefinition, TDraft extends ModuleDefinition, TOutput> = {
  config: ModuleKindConfig<TDef, TDraft, TOutput>;
  uploadMaxBatchFiles: number;
  uploadChunkFiles: number;
  /** 보관함에서 "선택 문서로 실행"으로 넘겨받은 문서(마운트 때 한 번 읽는다). */
  initialLibraryDocuments?: LibraryDocument[];
  /** 홈 모니터에서 배치를 열 때(?batch=) */
  initialBatchId?: string | null;
};

/** 단건 실행으로 연 문서·job. 없으면 활성 배치 항목을 보여준다. */
type SingleView = { documentId: string; jobId: string | null };

/** 결과 수정(저장 전). 저장 버튼을 누르기 전까지 서버에 보내지 않는다. */
type PendingOutput<TOutput> = { resultId: string; output: TOutput };

export function ModuleWorkspace<TDef extends ModuleDefinition, TDraft extends ModuleDefinition, TOutput>({
  config,
  uploadMaxBatchFiles,
  uploadChunkFiles,
  initialLibraryDocuments,
  initialBatchId
}: ModuleWorkspaceProps<TDef, TDraft, TOutput>) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const definitions = useDefinitionDraft(config);
  const { configLabel } = config;

  const [listOpen, setListOpen] = useState(false);
  /** 정의 카드 펼침. null이면 자동(결과가 있으면 접는다). */
  const [definitionOpen, setDefinitionOpen] = useState<boolean | null>(null);
  const [selectedDocuments, setSelectedDocuments] = useState<LibraryDocument[]>(() => initialLibraryDocuments ?? []);
  const [singleView, setSingleView] = useState<SingleView | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(initialBatchId ?? null);
  const [activeBatchItemId, setActiveBatchItemId] = useState<string | null>(null);
  const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: "", page: 0 });
  const [showRegions, setShowRegions] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(() =>
    initialLibraryDocuments?.length
      ? { tone: "info", text: `${initialLibraryDocuments.length.toLocaleString()}개 보관 문서를 선택했습니다.` }
      : null
  );
  const [pending, setPending] = useState<PendingOutput<TOutput> | null>(null);
  const [savingResult, setSavingResult] = useState(false);
  /** 실행 버튼이 완료를 기다리는 job(그동안 job query의 자체 폴링은 쉰다). */
  const [awaitedJobId, setAwaitedJobId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return () => controller.abort();
  }, []);

  const { batch: activeBatch, error: batchError } = useActiveModuleBatch(config, activeBatchId);
  const activeBatchItem = activeBatch?.items.find((item) => item.id === activeBatchItemId) ?? activeBatch?.items[0] ?? null;
  const batchView = activeBatch && activeBatchItem
    ? { documentId: activeBatchItem.document_id, jobId: activeBatchItem.job_id, pageNumber: activeBatchItem.page_number }
    : null;
  const view = singleView ?? batchView;
  // 보는 문서: 실행 결과가 있으면 그 문서, 아니면 한 문서만 골랐을 때 그 문서를 미리 본다.
  const previewDocumentId = view?.documentId ?? (selectedDocuments.length === 1 ? selectedDocuments[0].document_id : null);
  const documentQuery = useDocumentDetail(previewDocumentId);
  const document = previewDocumentId ? (documentQuery.data ?? null) : null;
  const jobId = view?.jobId ?? null;
  const jobQuery = useModuleJob<TOutput>(config, jobId, Boolean(jobId) && awaitedJobId === jobId);
  const job: ModuleJob<TOutput> | null = jobId ? (jobQuery.data ?? null) : null;
  const storedOutput = job?.result?.corrected_output ?? job?.result?.validated_output ?? null;
  const dirtyResult = Boolean(pending && job?.result_id && pending.resultId === job.result_id);
  const output = dirtyResult && pending ? pending.output : storedOutput;

  const pageKey = `${previewDocumentId ?? ""}:${jobId ?? ""}`;
  const activePage =
    pageState.key === pageKey ? pageState.page : initialPageIndex(job?.page_number ?? batchView?.pageNumber);
  const regions = config.regionsOf?.(definitions.draft) ?? [];
  const runCount = selectedDocuments.length || (document && view ? 1 : 0);
  const loadError = definitions.loadError ?? batchError ?? (previewDocumentId ? (documentQuery.error ?? jobQuery.error) : null);

  function notify(text: string, tone: NoticeTone = "info") {
    setNotice({ tone, text });
  }

  async function runTask(label: string, task: () => Promise<void>) {
    setBusy(label);
    setNotice(null);
    try {
      await task();
    } catch (error) {
      if (!isAbortError(error)) notify(toFriendlyError(error), "danger");
    } finally {
      setBusy(null);
    }
  }

  function resetView() {
    setSingleView(null);
    setActiveBatchId(null);
    setActiveBatchItemId(null);
  }

  /** 수정한 결과를 버리고 다른 결과로 옮겨 갈지 묻는다. */
  async function confirmDiscardEdits(): Promise<boolean> {
    if (!dirtyResult) return true;
    const accepted = await confirm({
      title: "저장하지 않은 수정",
      message: "결과 수정 내용을 저장하지 않았습니다. 버리고 이동할까요?",
      confirmLabel: "버리고 이동",
      tone: "danger"
    });
    if (accepted) setPending(null);
    return accepted;
  }

  // ---- 정의 ----

  async function removeDefinition(id: string) {
    const definition = definitions.definitions.find((item) => item.id === id);
    if (!definition) return;
    const accepted = await confirm({
      title: `${configLabel} 삭제`,
      message: `"${definition.name}"을(를) 삭제할까요?`,
      confirmLabel: "삭제",
      tone: "danger"
    });
    if (!accepted) return;
    try {
      const wasActive = await definitions.remove(definition.id);
      if (wasActive) definitions.startNew();
    } catch (error) {
      notify(toFriendlyError(error), "danger");
    }
  }

  // ---- 실행 ----

  function run() {
    if (!runCount) {
      notify("실행할 문서를 추가하거나 보관함에서 선택하세요.", "warning");
      return;
    }
    // 처리 단위는 페이지다. 여러 문서이거나 여러 페이지(또는 아직 페이지 수를 모르는) 문서는 배치로 펼친다.
    const single = selectedDocuments.length === 1 ? selectedDocuments[0] : null;
    const rerunDocumentId = !selectedDocuments.length ? (document?.document_id ?? null) : null;
    const useBatch = selectedDocuments.length > 1 || (single !== null && single.page_count !== 1);
    void runTask(useBatch ? "배치 작업을 생성하는 중" : "문서를 처리하는 중", async () => {
      if (!(await confirmDiscardEdits())) return;
      const configId = await definitions.save();
      if (useBatch) {
        await startBatch(configId, selectedDocuments);
      } else if (single) {
        setSelectedDocuments([]);
        await runSingle(configId, single.document_id, 1);
      } else if (rerunDocumentId) {
        // 보고 있는 결과를 다시 실행: 그 페이지만.
        await runSingle(configId, rerunDocumentId, job?.page_number ?? activePage + 1);
      }
    });
  }

  async function runSingle(configId: string, documentId: string, pageNumber: number) {
    const created = await createModuleJob<TOutput>(config, documentId, configId, pageNumber);
    const key = moduleKeys.job(config.kind, created.job_id);
    queryClient.setQueryData(key, created);
    setActiveBatchId(null);
    setSingleView({ documentId, jobId: created.job_id });
    setAwaitedJobId(created.job_id);
    try {
      const done = await waitForModuleJob<TOutput>(config, created.job_id, {
        signal: abortRef.current?.signal,
        onProgress: (progress) => queryClient.setQueryData(key, progress)
      });
      queryClient.setQueryData(key, done);
      if (done.status === "failed") notify(done.error_message || "실행에 실패했습니다.", "danger");
      else notify(config.resultMessage, "success");
    } finally {
      setAwaitedJobId(null);
    }
  }

  async function startBatch(configId: string, documents: LibraryDocument[]) {
    const batch = await createBatchFromDocuments(
      config,
      configId,
      documents.map((item) => item.document_id)
    );
    showBatch(batch);
    setSelectedDocuments([]);
    notify(
      `${documents.length.toLocaleString()}개 문서의 배치 작업을 시작했습니다. 페이지마다 한 항목으로 처리하며, 변환 중인 문서는 준비되면 페이지가 추가됩니다.`,
      "success"
    );
  }

  /** 서버가 돌려준 배치를 캐시에 넣고 첫 항목을 연다. */
  function showBatch(batch: ModuleBatch) {
    writeBatchCache(queryClient, config.kind, batch);
    setSingleView(null);
    setActiveBatchId(batch.id);
    setActiveBatchItemId(batch.items[0]?.id ?? null);
  }

  async function openBatchItem(itemId: string) {
    if (itemId === activeBatchItem?.id && !singleView) return;
    if (!(await confirmDiscardEdits())) return;
    setSingleView(null);
    setActiveBatchItemId(itemId);
  }

  async function stopActiveBatch(batch: ModuleBatch) {
    const accepted = await confirm({
      title: "배치 중단",
      message: "남은 처리를 멈추고 업로드 산출물을 정리합니다. 이미 끝난 결과와 배치 기록은 남습니다.",
      confirmLabel: "중단",
      tone: "danger"
    });
    if (!accepted) return;
    try {
      writeBatchCache(queryClient, config.kind, await discardBatch(config, batch.id));
      notify("배치를 중단했습니다. 끝난 결과와 기록은 남아 있습니다.", "info");
    } catch (error) {
      notify(toFriendlyError(error), "danger");
    }
  }

  async function resumeActiveBatch(batch: ModuleBatch) {
    try {
      showBatch(await resumeBatch(config, batch.id));
      notify("등록된 문서 기준으로 배치 처리를 계속합니다.", "info");
    } catch (error) {
      notify(toFriendlyError(error), "danger");
    }
  }

  async function saveResult() {
    if (!job?.result_id || !pending || !dirtyResult) return;
    setSavingResult(true);
    try {
      const result = await patchModuleResult<TOutput>(config, job.result_id, pending.output);
      queryClient.setQueryData(moduleKeys.job(config.kind, job.job_id), { ...job, result });
      setPending(null);
      notify("수정한 결과를 저장했습니다.", "success");
    } catch (error) {
      notify(toFriendlyError(error), "danger");
    } finally {
      setSavingResult(false);
    }
  }

  // ---- 문서 선택 ----

  async function selectDocuments(documents: LibraryDocument[]) {
    if (!(await confirmDiscardEdits())) return;
    setSelectedDocuments(documents);
    resetView();
    if (documents.length) notify(`${documents.length.toLocaleString()}개 보관 문서를 선택했습니다.`);
    else setNotice(null);
  }

  const actionContext: ModuleActionContext<TDraft> = {
    draft: definitions.draft,
    document,
    busy: Boolean(busy),
    runTask,
    replaceDraft: definitions.replaceDraft,
    setShowRegions,
    notify
  };
  const { DefinitionEditor, ResultPanel, HeaderActions } = config;
  const counts = activeBatch ? batchRailCounts(activeBatch) : null;
  const viewLabel = document ? documentLabel(document.filename, job?.page_number ?? batchView?.pageNumber) : null;
  const headerTitle =
    view && viewLabel
      ? viewLabel
      : selectedDocuments.length === 1
        ? selectedDocuments[0].filename
        : selectedDocuments.length
          ? summarizeDocuments(selectedDocuments)
          : activeBatch
            ? `배치 · ${activeBatch.total_count.toLocaleString()}개 페이지`
            : "문서를 선택하세요";
  const steps = [
    { label: "문서", active: !runCount && !view, done: Boolean(runCount || view) },
    { label: config.configLabel, active: Boolean(runCount) && !view, done: Boolean(definitions.activeConfigId) && !definitions.dirty },
    { label: "실행", active: Boolean(busy) || isActiveStatus(activeBatch?.status), done: Boolean(job || activeBatch) },
    { label: "검토", active: Boolean(output), done: Boolean(job?.result?.reviewed) }
  ];

  const resultExportOptions: ExportMenuOption[] = output
    ? [
        {
          format: "json",
          onExport: () =>
            downloadJson(`${safeFilename(viewLabel ?? config.title)}.json`, {
              document_id: job?.document_id,
              filename: document?.filename,
              page_number: job?.page_number ?? null,
              result: output
            })
        },
        {
          format: "csv",
          onExport: () =>
            downloadCsv(
              `${safeFilename(viewLabel ?? config.title)}.csv`,
              config.exportRows(output).map((row) => ({ filename: document?.filename, page_number: job?.page_number ?? null, ...row }))
            )
        }
      ]
    : [];

  const mainContent = document && (view || selectedDocuments.length === 1) ? (
    <DocumentViewer
      document={document}
      activePage={activePage}
      onPage={(page) => setPageState({ key: pageKey, page })}
      eyebrow={view ? "결과 문서" : "미리보기"}
      title={viewLabel ?? document.filename}
      regions={regions}
      showRegions={showRegions}
      onShowRegions={config.regionsOf ? setShowRegions : undefined}
      onClear={view ? undefined : () => void selectDocuments([])}
    />
  ) : selectedDocuments.length > 1 ? (
    <LibraryDocumentSelectionPreview documents={selectedDocuments} onClear={() => void selectDocuments([])} />
  ) : previewDocumentId ? (
    <EmptyState title="문서를 불러오는 중입니다." />
  ) : (
    <DocumentInput
      variant="zone"
      maxFiles={uploadMaxBatchFiles}
      chunkSize={uploadChunkFiles}
      selectedDocuments={selectedDocuments}
      onReady={(documents) => void selectDocuments(documents)}
      onNotice={(next) => setNotice(next)}
      description={`PDF·이미지·Office 문서를 올리면 보관함에 저장한 뒤 페이지 단위로 ${config.title}합니다.`}
    />
  );

  const definitionCollapsed = definitionOpen === null ? Boolean(output) : !definitionOpen;
  const definitionCard = (
    <Card
      className="module-definition-card"
      eyebrow={configLabel}
      title={definitions.draft.name}
      collapsed={definitionCollapsed}
      onToggle={() => setDefinitionOpen(definitionCollapsed)}
      summary={`${definitions.activeConfigId ? "저장된 " : ""}${configLabel} · 펼쳐서 편집`}
      actions={
        <>
          <SaveIndicator state={definitions.saveState} message={definitions.saveMessage} />
          <Button size="sm" icon={<Library size={15} />} onClick={() => setListOpen(true)}>
            목록
          </Button>
          {HeaderActions && <HeaderActions {...actionContext} />}
        </>
      }
    >
      {definitions.saveMessage && definitions.saveState !== "saved" && (
        <InlineAlert tone={definitions.saveState === "error" ? "danger" : "warning"}>{definitions.saveMessage}</InlineAlert>
      )}
      <DefinitionEditor
        draft={definitions.draft}
        onDraft={definitions.setDraft}
        showRegions={showRegions}
        onShowRegions={setShowRegions}
        document={document}
      />
    </Card>
  );

  const resultCard = (
    <Card
      className="module-result-card"
      eyebrow="결과"
      title={job ? statusLabel(job.status) : "실행 대기"}
      actions={dirtyResult ? <SaveIndicator state="dirty" label="수정됨 · 저장 전" /> : undefined}
      footer={
        output ? (
          <>
            <Button
              size="sm"
              variant={dirtyResult ? "primary" : "secondary"}
              icon={<Save size={14} />}
              disabled={!dirtyResult}
              loading={savingResult}
              onClick={() => void saveResult()}
            >
              수정 저장
            </Button>
            <ExportMenu compact align="right" options={resultExportOptions} title="이 결과만 내보내기" />
          </>
        ) : undefined
      }
    >
      {viewLabel && job && <small className="ui-card-source">{viewLabel}</small>}
      <ResultPanel
        job={job}
        draft={definitions.draft}
        output={output}
        onChange={(next) => job?.result_id && setPending({ resultId: job.result_id, output: next })}
        onGoToPage={(page) => setPageState({ key: pageKey, page: Math.max(0, page - 1) })}
      />
    </Card>
  );

  return (
    <ModulePage
      module={config.kind}
      header={
        <PageHeader
          eyebrow={config.title}
          title={headerTitle}
          description={config.description}
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
        activeBatch && counts ? (
          <JobStatusBar
            eyebrow="배치"
            status={activeBatch.status}
            progress={activeBatch.progress}
            processed={counts.finished}
            total={activeBatch.total_count}
            counters={{
              total: activeBatch.total_count,
              completed: activeBatch.completed_count,
              needsReview: counts.needsReview,
              failed: activeBatch.failed_count
            }}
            onNextReview={() => {
              const next = nextReviewItem(activeBatch.items, activeBatchItem?.id ?? null);
              if (next) void openBatchItem(next.id);
            }}
            exportOptions={jobExportOptions(config.exportOwnerType, activeBatch.id)}
            exportFooter={<ExportJobHistory ownerType={config.exportOwnerType} ownerId={activeBatch.id} compact limit={3} />}
            onResume={batchCanResume(activeBatch) ? () => void resumeActiveBatch(activeBatch) : undefined}
            onStop={batchCanDiscard(activeBatch) ? () => void stopActiveBatch(activeBatch) : undefined}
          />
        ) : null
      }
    >
      <SplitPane
        leftLabel="문서"
        rightLabel={`${configLabel}과 결과`}
        left={
          <div className={activeBatch ? "ui-document-area with-rail" : "ui-document-area"}>
            {activeBatch && (
              <BatchItemRail
                items={activeBatch.items.map((item) => ({ ...item, label: batchItemLabel(item) }))}
                activeItemId={singleView ? null : (activeBatchItem?.id ?? null)}
                onOpen={(itemId) => void openBatchItem(itemId)}
              />
            )}
            <div className="ui-document-main">{mainContent}</div>
          </div>
        }
        right={
          <ResponsiveTabs
            label="설정과 결과"
            defaultTab={output ? "result" : "definition"}
            tabs={[
              { id: "definition", label: configLabel, content: definitionCard },
              { id: "result", label: "결과", content: resultCard }
            ]}
          />
        }
      />
      <DefinitionListDrawer
        open={listOpen}
        eyebrow={config.libraryLabel}
        title={`${configLabel} 목록`}
        newLabel={`새 ${configLabel}`}
        items={definitions.definitions.map((definition) => ({
          id: definition.id,
          name: definition.name,
          summary: config.summarize(definition)
        }))}
        activeId={definitions.activeConfigId}
        draftName={definitions.activeConfigId ? null : definitions.draft.name || `새 ${configLabel}`}
        onNew={() => {
          definitions.startNew();
          setListOpen(false);
        }}
        onLoad={(id) => {
          const definition = definitions.definitions.find((item) => item.id === id);
          if (definition) definitions.load(definition);
          setListOpen(false);
        }}
        onDuplicate={(id) =>
          void runTask(`${configLabel} 복제 중`, async () => {
            await definitions.duplicate(id);
            setListOpen(false);
            notify(`복제한 ${configLabel}을 불러왔습니다.`, "success");
          })
        }
        onDelete={(id) => void removeDefinition(id)}
        onClose={() => setListOpen(false)}
      />
    </ModulePage>
  );
}
