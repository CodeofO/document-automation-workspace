// 핵심 정보 추출 화면 (/key-info). 다른 모듈과 같은 뼈대(spec B-1):
// PageHeader → InlineAlert → JobStatusBar → SplitPane[문서(Rail+뷰어) | Schema 카드 → 검수 카드].
// 상태는 hooks로 나눴다: useSchemaDraft(초안·자동 저장), useKieBatches(배치), useKieReview(검수).
import { useQuery } from "@tanstack/react-query";
import { History, Library, Play, Save, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, isAbortError, jsonBody, toFriendlyError } from "../../api/client";
import { DocumentViewer, type ZoomMode } from "../../components/document/DocumentViewer";
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
  StatusBadge,
  useConfirm,
  type AlertTone
} from "../../components/ui";
import { summarizeDocuments } from "../../lib/files";
import { documentLabel, formatDate, formatElapsedTime } from "../../lib/format";
import { isActiveStatus, statusLabel } from "../../lib/status";
import { ExportJobHistory } from "../export-jobs";
import {
  DocumentInput,
  LibraryDocumentSelectionPreview,
  useHandedOffDocuments,
  waitForDocumentReady,
  type LibraryDocument
} from "../library";
import { batchCanDiscard, batchCanResume, batchIsActive } from "../module-batch/batchRules";
import { BatchItemRail } from "../module-batch/BatchItemRail";
import { PARSING_HISTORY_CLEARED_EVENT, useUploadLimits } from "../settings";
import {
  EXTRACTION_LONG_RUNNING_NOTICE_MS,
  createBatchFromDocuments,
  getBatch,
  getDocument,
  getExtractionJob,
  kieKeys,
  pollExtractionJob,
  searchArchive
} from "./api";
import { ArchiveDialog, BatchHistoryDrawer, SchemaListExtras } from "./components/KieTools";
import { RecommendationDiffDialog, ReviewPanel } from "./components/ReviewPanel";
import { SchemaEditor } from "./components/SchemaEditor";
import { useKieBatches } from "./hooks/useKieBatches";
import { useKieReview } from "./hooks/useKieReview";
import { useSchemaDraft } from "./hooks/useSchemaDraft";
import { batchJobExportOptions, documentPageImageSrc, resultExportOptions } from "./model/review";
import type { Batch, ExtractionJob, SavedSchema, SchemaRecommendation, Step, UploadedDocument } from "./types";
import { persistedKieState, savePersistedKieState } from "./workspaceState";

type Notice = { tone: AlertTone; text: string };

/** 핵심 정보 추출 화면 (/key-info). 문서 → schema → 추출 → 검수, 그리고 배치 추출. */
export function KeyInfoWorkspace() {
  const { uploadMaxBatchFiles, uploadChunkFiles, systemStatus } = useUploadLimits();
  const handedOffDocuments = useHandedOffDocuments("key-info");
  const [searchParams] = useSearchParams();
  const initialBatchId = searchParams.get("batch");
  const confirm = useConfirm();

  const [step, setStep] = useState<Step>("upload");
  const [document, setDocument] = useState<UploadedDocument | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fitWidth");
  const [rotation, setRotation] = useState(0);
  const [pendingRecommendation, setPendingRecommendation] = useState<SchemaRecommendation | null>(null);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveStatus, setArchiveStatus] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [schemaListOpen, setSchemaListOpen] = useState(false);
  /** Schema 카드 펼침. null이면 자동(결과가 있으면 접는다). */
  const [schemaOpen, setSchemaOpen] = useState<boolean | null>(null);
  const [selectedDocuments, setSelectedDocuments] = useState<LibraryDocument[]>(
    handedOffDocuments.length > 1 ? handedOffDocuments : []
  );
  const [notice, setNotice] = useState<Notice | null>(() =>
    handedOffDocuments.length
      ? { tone: "info", text: `${handedOffDocuments.length.toLocaleString()}개 보관 문서를 선택했습니다.` }
      : null
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [savingResult, setSavingResult] = useState(false);
  const [workspaceRestored, setWorkspaceRestored] = useState(false);
  const documentCacheRef = useRef<Map<string, UploadedDocument>>(new Map());
  const jobCacheRef = useRef<Map<string, ExtractionJob>>(new Map());
  const loadJobRequestRef = useRef(0);
  const loadJobAbortRef = useRef<AbortController | null>(null);

  const schema = useSchemaDraft({ enabled: workspaceRestored, onError: setError });
  const batches = useKieBatches(initialBatchId);
  const review = useKieReview(schema.schema?.id ?? null);
  const { activeBatch, activeItem } = batches;
  const job = review.job;
  const result = review.result;

  const archiveQueryResult = useQuery({
    queryKey: kieKeys.archive(archiveQuery, archiveStatus),
    queryFn: () => searchArchive(archiveQuery, archiveStatus),
    enabled: archiveOpen
  });

  const regionPages = useMemo(
    () => (document?.pages ?? []).map((page) => ({ id: page.id, page: page.page, image_url: page.image_url })),
    [document]
  );
  const activeImageUrl = useMemo(() => {
    if (!document?.pages.length) return null;
    const page = document.pages[activePage];
    return page ? documentPageImageSrc(page) : null;
  }, [document, activePage]);

  // ---- 저장된 작업 상태 ----
  useEffect(() => {
    if (!workspaceRestored) return;
    savePersistedKieState({
      step,
      document_id: document?.document_id ?? null,
      schema_id: schema.schema?.id ?? null,
      job_id: job?.job_id ?? null,
      batch_id: batches.activeBatchId,
      batch_item_id: activeItem?.id ?? null,
      active_page: activePage
    });
  }, [workspaceRestored, step, document?.document_id, schema.schema?.id, job?.job_id, batches.activeBatchId, activeItem?.id, activePage]);

  // ---- 열린 배치의 현재 항목 결과를 배치 갱신과 함께 따라간다 ----
  const batchPollingActive = Boolean(activeBatch && batchIsActive(activeBatch));
  const refreshItemRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!batchPollingActive) return;
    void refreshItemRef.current();
  }, [batchPollingActive, batches.dataUpdatedAt, activeItem?.id]);

  // ---- 첫 진입: 넘겨받은 문서 > ?batch= > 저장된 상태 복원 ----
  useEffect(() => {
    let cancelled = false;
    const [single] = handedOffDocuments;
    const start =
      handedOffDocuments.length === 1 && single
        ? openLibraryDocument(single.document_id)
        : handedOffDocuments.length
          ? Promise.resolve()
          : initialBatchId
            ? openBatch(initialBatchId)
            : restoreWorkspaceState();
    void start.finally(() => {
      if (!cancelled) setWorkspaceRestored(true);
    });
    return () => {
      cancelled = true;
    };
    // 마운트 시 한 번만 실행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 설정에서 파싱 기록을 지우면 화면 상태도 비운다 ----
  useEffect(() => {
    const onCleared = () => {
      setDocument(null);
      batches.close();
      review.reset();
      setStep("upload");
      persistedKieState.clear();
    };
    window.addEventListener(PARSING_HISTORY_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(PARSING_HISTORY_CLEARED_EVENT, onCleared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function withBusy(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (err) {
      if (!isAbortError(err)) setError(toFriendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function restoreWorkspaceState() {
    const saved = persistedKieState.read();
    if (!saved) return;
    try {
      if (saved.batch_id) {
        await openBatch(saved.batch_id, saved.batch_item_id);
        return;
      }
      if (saved.job_id) {
        const loadedJob = await getExtractionJob(saved.job_id);
        const [loadedDocument, loadedSchema] = await Promise.all([
          getDocument(loadedJob.document_id),
          schema.getCached(loadedJob.schema_id)
        ]);
        applyDocument(loadedDocument);
        schema.apply(loadedSchema);
        review.setJob(loadedJob);
        if (loadedJob.result) review.applyResult(loadedJob.result);
        setStep(saved.step ?? (loadedJob.result ? "review" : "schema"));
        setActivePage(Math.min(Math.max(0, saved.active_page ?? 0), Math.max(0, loadedDocument.page_count - 1)));
        return;
      }
      if (saved.document_id) {
        const loadedDocument = await getDocument(saved.document_id);
        applyDocument(loadedDocument);
        setActivePage(Math.min(Math.max(0, saved.active_page ?? 0), Math.max(0, loadedDocument.page_count - 1)));
      }
      if (saved.schema_id) schema.apply(await schema.getCached(saved.schema_id));
      if (saved.document_id || saved.schema_id) setStep(saved.step === "review" ? "schema" : saved.step);
    } catch {
      persistedKieState.clear();
    }
  }

  function applyDocument(next: UploadedDocument, options: { clearExtractionState?: boolean } = {}) {
    const isSame = document?.document_id === next.document_id;
    documentCacheRef.current.set(next.document_id, next);
    setDocument((current) => (current?.document_id === next.document_id ? current : next));
    if (!isSame) {
      setActivePage(0);
      setRotation(0);
    }
    if (options.clearExtractionState === false) return;
    review.reset();
  }

  function clearDocument() {
    setDocument(null);
    setActivePage(0);
    setRotation(0);
    batches.close();
    review.reset();
    setStep("upload");
  }

  /** 보관함 문서 하나를 연다(준비될 때까지 기다린 뒤). 최근 추출 결과가 있으면 같이 연다. */
  async function openLibraryDocument(documentId: string) {
    await withBusy("문서를 여는 중", async () => {
      batches.close();
      const ready = await waitForDocumentReady(documentId);
      const loaded = ready.pages?.length ? (ready as unknown as UploadedDocument) : await getDocument(documentId);
      applyDocument(loaded);
      void review.loadAudit("document", loaded.document_id);
      const jobs = await api<ExtractionJob[]>(`/api/extraction-jobs?document_id=${documentId}&limit=1`);
      const latest = jobs[0];
      if (latest?.result) {
        review.setJob(latest);
        schema.apply(await schema.getCached(latest.schema_id));
        review.applyResult(latest.result);
        setStep("review");
      } else {
        setStep("schema");
      }
    });
  }

  async function selectDocuments(documents: LibraryDocument[]) {
    if (!(await confirmDiscardReview())) return;
    setNotice(null);
    if (documents.length === 1) {
      setSelectedDocuments([]);
      await openLibraryDocument(documents[0].document_id);
      return;
    }
    clearDocument();
    setSelectedDocuments(documents);
    if (documents.length) setNotice({ tone: "info", text: `${documents.length.toLocaleString()}개 보관 문서를 선택했습니다.` });
  }

  async function confirmDiscardReview() {
    if (!review.dirty) return true;
    return confirm({
      title: "저장하지 않은 검수",
      message: "수정한 값이나 검수 표시를 저장하지 않았습니다. 버리고 이동할까요?",
      confirmLabel: "버리고 이동",
      tone: "danger"
    });
  }

  // ---- AI 추천 ----

  async function recommendSchema() {
    await withBusy("AI schema 추천 중", async () => {
      let source = document;
      if (!source && selectedDocuments.length) {
        const ready = await waitForDocumentReady(selectedDocuments[0].document_id);
        source = await getDocument(ready.document_id);
        applyDocument(source);
        setStep("schema");
      }
      if (!source) throw new Error("AI 추천을 쓰려면 먼저 문서를 여세요.");
      const recommendation = await api<SchemaRecommendation>(
        "/api/schemas/recommendations",
        jsonBody("POST", { document_id: source.document_id })
      );
      if (schema.meaningful) setPendingRecommendation(recommendation);
      else {
        schema.applyRecommendation(recommendation);
        setStep("schema");
      }
      setDocument(await getDocument(source.document_id));
    });
  }

  // ---- 실행 ----

  function run() {
    if (selectedDocuments.length > 1) void runBatch(selectedDocuments.map((item) => item.document_id));
    // 여러 페이지 문서 전체는 배치 경로로 페이지마다 한 항목씩 만든다.
    else if (document && document.page_count > 1) void runBatch([document.document_id]);
    else void runExtraction();
  }

  /** 보고 있는 페이지 하나만 추출한다(영역을 그린 페이지 확인용). */
  async function runExtraction() {
    if (!document) {
      setNotice({ tone: "warning", text: "먼저 문서를 추가하거나 보관함에서 여세요." });
      return;
    }
    if (schema.validationError) {
      setError(schema.validationError);
      return;
    }
    if (!(await confirmDiscardReview())) return;
    const pageNumber = document.pages[activePage]?.page ?? activePage + 1;
    await withBusy("핵심 정보 추출 중", async () => {
      const source = schema.extractionSource();
      const created =
        "schemaId" in source
          ? await api<ExtractionJob>(
              "/api/extraction-jobs",
              jsonBody("POST", { document_id: document.document_id, page_number: pageNumber, schema_id: source.schemaId })
            )
          : await api<ExtractionJob>(
              "/api/extraction-jobs/draft",
              jsonBody("POST", { document_id: document.document_id, page_number: pageNumber, schema: source.draft })
            );
      batches.close();
      review.reset();
      review.setJob(created);
      setStep("review");
      const completed = await pollExtractionJob(created.job_id, {
        onProgress: (next, elapsedMs) => {
          review.setJob(next);
          if (elapsedMs >= EXTRACTION_LONG_RUNNING_NOTICE_MS) {
            setBusy(`핵심 정보 추출 중 · ${formatElapsedTime(elapsedMs)} 경과 · 로컬 VLM은 수 분 이상 걸릴 수 있습니다`);
          }
        }
      });
      review.setJob(completed);
      if (completed.result) review.applyResult(completed.result);
      if (completed.status === "failed") setError(completed.error_message || "추출에 실패했습니다.");
    });
  }

  async function runBatch(documentIds: string[]) {
    if (!schema.ready) {
      setNotice({
        tone: "warning",
        text: `Schema를 먼저 완성하세요. ${schema.saveMessage ?? schema.validationError ?? ""}`.trim()
      });
      return;
    }
    await withBusy("배치 추출 준비 중", async () => {
      let saved: SavedSchema | null = schema.schema && !schema.schema.ephemeral && !schema.dirty ? schema.schema : null;
      if (!saved) saved = await schema.persist({ silent: true });
      if (!saved) throw new Error("현재 schema를 저장하지 못해 배치 추출을 시작하지 않았습니다. Schema 상태를 확인하세요.");
      const batch = await createBatchFromDocuments(saved.id, documentIds);
      const count = documentIds.length;
      setSelectedDocuments([]);
      batches.putBatch(batch);
      batches.setActiveBatchId(batch.id);
      setNotice({
        tone: "success",
        text: `${count.toLocaleString()}개 문서의 배치 추출을 시작했습니다. 페이지마다 한 항목으로 처리하며, 변환 중인 문서는 준비되면 페이지가 추가됩니다.`
      });
      if (batch.items[0]) await openBatchItem(batch, batch.items[0].id);
      else setStep("review");
      await batches.refresh();
    });
  }

  async function saveCorrections() {
    setSavingResult(true);
    setError(null);
    try {
      await review.save();
      setNotice({ tone: "success", text: "수정한 결과를 저장했습니다." });
    } catch (err) {
      setError(toFriendlyError(err));
    } finally {
      setSavingResult(false);
    }
  }

  // ---- job·배치 열기 ----

  async function getCachedDocument(documentId: string, signal?: AbortSignal) {
    const cached = documentCacheRef.current.get(documentId);
    if (cached) return cached;
    const loaded = await getDocument(documentId, signal);
    documentCacheRef.current.set(documentId, loaded);
    return loaded;
  }

  function applyLoadedJob(loadedJob: ExtractionJob, loadedDocument: UploadedDocument, loadedSchema: SavedSchema) {
    applyDocument(loadedDocument, { clearExtractionState: false });
    if (loadedJob.page_number) setActivePage(Math.max(0, loadedJob.page_number - 1));
    if (!schema.schema || schema.schema.id !== loadedSchema.id) schema.apply(loadedSchema);
    review.setJob(loadedJob);
    if (loadedJob.result) review.applyResult(loadedJob.result);
    else review.clear();
    setStep("review");
  }

  async function loadJob(jobId: string, options: { keepBatch?: boolean } = {}) {
    const requestId = ++loadJobRequestRef.current;
    loadJobAbortRef.current?.abort();
    const controller = new AbortController();
    loadJobAbortRef.current = controller;
    setError(null);
    try {
      if (!options.keepBatch) batches.close();
      const cachedJob = jobCacheRef.current.get(jobId);
      const cachedDocument = cachedJob ? documentCacheRef.current.get(cachedJob.document_id) : null;
      if (cachedJob && cachedDocument) {
        applyLoadedJob(cachedJob, cachedDocument, await schema.getCached(cachedJob.schema_id));
      }
      const loadedJob = await getExtractionJob(jobId, controller.signal);
      jobCacheRef.current.set(jobId, loadedJob);
      const [loadedDocument, loadedSchema] = await Promise.all([
        getCachedDocument(loadedJob.document_id, controller.signal),
        schema.getCached(loadedJob.schema_id, { signal: controller.signal })
      ]);
      if (requestId !== loadJobRequestRef.current || controller.signal.aborted) return;
      applyLoadedJob(loadedJob, loadedDocument, loadedSchema);
    } catch (err) {
      if (!isAbortError(err)) setError(toFriendlyError(err));
    } finally {
      if (loadJobAbortRef.current === controller) loadJobAbortRef.current = null;
    }
  }

  async function openBatch(batchId: string, itemId?: string | null) {
    const loaded = await getBatch(batchId);
    batches.putBatch(loaded);
    batches.setActiveBatchId(loaded.id);
    const item = loaded.items.find((candidate) => candidate.id === itemId) ?? loaded.items[0];
    if (item) await openBatchItem(loaded, item.id);
  }

  async function openBatchItem(batch: Batch, itemId: string) {
    const item = batch.items.find((candidate) => candidate.id === itemId) ?? batch.items[0];
    if (!item) return;
    if (batch.id === batches.activeBatchId && item.id === activeItem?.id && job?.job_id === item.job_id) return;
    if (!(await confirmDiscardReview())) return;
    batches.putBatch(batch);
    batches.setActiveBatchId(batch.id);
    batches.setActiveItemId(item.id);
    setStep("review");
    await loadJob(item.job_id, { keepBatch: true });
  }

  async function refreshActiveItemJob() {
    if (!activeItem) return;
    try {
      const loadedJob = await getExtractionJob(activeItem.job_id);
      jobCacheRef.current.set(loadedJob.job_id, loadedJob);
      if (loadedJob.job_id !== job?.job_id) {
        await loadJob(loadedJob.job_id, { keepBatch: true });
        return;
      }
      review.setJob(loadedJob);
      if (loadedJob.result && (loadedJob.result_id !== job?.result_id || !result)) review.applyResult(loadedJob.result);
    } catch {
      // 폴링 실패가 보이는 검수 흐름을 끊지 않게 한다.
    }
  }
  useEffect(() => {
    refreshItemRef.current = refreshActiveItemJob;
  });

  async function stopBatch(batchId: string) {
    const accepted = await confirm({
      title: "배치 중단",
      message: "남은 처리를 멈추고 업로드 산출물을 정리합니다. 이미 끝난 결과와 배치 기록은 남습니다.",
      confirmLabel: "중단",
      tone: "danger"
    });
    if (!accepted) return;
    await withBusy("배치 추출 중단 중", async () => {
      await batches.discard(batchId);
      setNotice({ tone: "info", text: "배치를 중단했습니다. 끝난 결과와 기록은 남아 있습니다." });
    });
  }

  function goToPage(page: number) {
    if (!document) return;
    setActivePage(Math.min(document.page_count - 1, Math.max(0, page - 1)));
  }

  // ---- 화면 ----

  const runCount = selectedDocuments.length > 1 ? selectedDocuments.length : document ? 1 : 0;
  const multiPage = selectedDocuments.length > 1 || (document?.page_count ?? 0) > 1;
  const headerTitle = activeBatch
    ? activeItem
      ? documentLabel(activeItem.filename, activeItem.page_number)
      : "배치"
    : document
      ? document.filename
      : selectedDocuments.length
        ? summarizeDocuments(selectedDocuments)
        : "문서를 선택하세요";
  const steps = [
    { label: "문서", active: step === "upload", done: Boolean(document || selectedDocuments.length || activeBatch) },
    { label: "Schema", active: step === "schema", done: Boolean(schema.schema) && !schema.dirty },
    { label: "추출", active: Boolean(busy) || batchPollingActive, done: Boolean(job) },
    { label: "검수", active: step === "review" && Boolean(result), done: Boolean(result?.reviewed_fields?.length) }
  ];
  const finished = activeBatch ? activeBatch.completed_count + activeBatch.failed_count + activeBatch.canceled_count : 0;
  const needsReviewCount =
    activeBatch?.needs_review_count ?? activeBatch?.items.filter((item) => item.status === "needs_review").length ?? 0;

  const mainContent = document ? (
    <DocumentViewer
      document={document}
      activePage={activePage}
      activeImageUrl={activeImageUrl}
      regions={schema.assignedRegions}
      showRegions={schema.regionsVisible && schema.assignedRegions.length > 0}
      hideThumbnailRail={Boolean(activeBatch)}
      zoom={zoom}
      zoomMode={zoomMode}
      rotation={rotation}
      eyebrow={activeBatch ? "배치 항목" : "문서"}
      title={activeItem && activeBatch ? documentLabel(activeItem.filename, activeItem.page_number) : document.filename}
      onPage={setActivePage}
      onShowRegions={schema.setRegionsVisible}
      onZoom={setZoom}
      onZoomMode={setZoomMode}
      onRotation={setRotation}
      onClear={activeBatch ? undefined : clearDocument}
      toolbarExtra={
        document.page_count > 1 && !activeBatch ? (
          <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void runExtraction()}>
            이 페이지만 추출
          </Button>
        ) : undefined
      }
    />
  ) : selectedDocuments.length ? (
    <LibraryDocumentSelectionPreview
      documents={selectedDocuments}
      onClear={() => setSelectedDocuments([])}
      onOpen={(item) => void selectDocuments([item])}
      hint="여러 문서는 같은 schema로 배치 추출합니다. 문서를 누르면 하나만 열어 schema를 다듬을 수 있습니다."
    />
  ) : activeBatch ? (
    <EmptyState title="항목을 불러오는 중입니다." />
  ) : (
    <DocumentInput
      variant="zone"
      maxFiles={uploadMaxBatchFiles}
      chunkSize={uploadChunkFiles}
      onReady={(documents) => void selectDocuments(documents)}
      onNotice={setNotice}
      description="문서 하나를 열면 schema를 다듬고 바로 추출합니다. 여러 문서는 같은 schema로 배치 추출합니다."
    />
  );

  const schemaCollapsed = schemaOpen === null ? Boolean(result) : !schemaOpen;
  const schemaCard = (
    <Card
      className="module-definition-card"
      eyebrow="Schema"
      title={schema.schema?.display_name || schema.schemaName || "새 schema"}
      collapsed={schemaCollapsed}
      onToggle={() => setSchemaOpen(schemaCollapsed)}
      summary={`${schema.fields.length}개 필드 · ${schema.regions.length}개 영역 · 펼쳐서 편집`}
      actions={
        <>
          <SaveIndicator state={schema.saveState} message={schema.saveMessage} />
          <Button size="sm" icon={<Library size={15} />} onClick={() => setSchemaListOpen(true)}>
            목록
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Sparkles size={15} />}
            disabled={Boolean(busy) || (!document && !selectedDocuments.length)}
            title={document || selectedDocuments.length ? "AI가 현재 문서를 보고 schema를 추천합니다." : "문서를 먼저 열어야 합니다."}
            onClick={() => void recommendSchema()}
          >
            AI 추천
          </Button>
        </>
      }
    >
      {schema.saveMessage && schema.dirty && (
        <InlineAlert tone={schema.saveState === "error" ? "danger" : "warning"}>{schema.saveMessage}</InlineAlert>
      )}
      <SchemaEditor
        schema={schema}
        pages={regionPages}
        activePage={activePage}
        onRecommendDescription={() =>
          void withBusy("스키마 설명 다듬는 중", () => schema.recommendDescription(document?.document_id ?? null))
        }
      />
    </Card>
  );

  const reviewCard = (
    <Card
      className="module-result-card"
      eyebrow="검수"
      title={result ? "추출 결과" : job ? statusLabel(job.status) : activeItem ? statusLabel(activeItem.status) : "추출 대기"}
      actions={review.dirty ? <SaveIndicator state="dirty" label="수정됨 · 저장 전" /> : undefined}
      footer={
        result ? (
          <>
            <Button
              size="sm"
              variant={review.dirty ? "primary" : "secondary"}
              icon={<Save size={14} />}
              disabled={!review.dirty}
              loading={savingResult}
              onClick={() => void saveCorrections()}
            >
              수정 저장
            </Button>
            <select
              aria-label="Export preset"
              className="ui-compact-select"
              value={review.selectedPresetId}
              onChange={(event) => review.setSelectedPresetId(event.target.value)}
            >
              <option value="">기본 열</option>
              {review.exportPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              disabled={!schema.schema}
              title="현재 필드 순서로 export preset을 만듭니다."
              onClick={() =>
                void withBusy("Export preset 저장 중", () =>
                  review.savePreset(`${schema.schemaName || "schema"} export`, schema.payloadFields)
                )
              }
            >
              Preset 저장
            </Button>
            <ExportMenu compact align="right" options={resultExportOptions(result.id, review.selectedPresetId)} />
          </>
        ) : undefined
      }
    >
      {result ? (
        <ReviewPanel
          fields={schema.payloadFields}
          review={review}
          onGoToPage={goToPage}
          onRetryExtraction={() => {
            review.reset();
            review.setFilter("needs_review");
            setSchemaOpen(true);
            setStep("schema");
          }}
        />
      ) : activeItem && activeBatch ? (
        <EmptyState compact title={<StatusBadge status={activeItem.status} />}>
          {activeItem.error_message ??
            (isActiveStatus(activeItem.status) ? "이 항목을 처리하는 중입니다. 끝나면 결과가 표시됩니다." : "이 항목의 결과가 없습니다.")}
        </EmptyState>
      ) : job ? (
        <EmptyState compact title={<StatusBadge status={job.status} />}>
          {job.error_message ?? "추출이 끝나면 결과가 표시됩니다."}
        </EmptyState>
      ) : (
        <EmptyState compact title="아직 추출 결과가 없습니다.">
          문서를 열고 실행하면 필드별 값과 근거가 여기에 표시됩니다.
        </EmptyState>
      )}
    </Card>
  );

  return (
    <ModulePage
      module="key-info"
      header={
        <PageHeader
          eyebrow="핵심 정보 추출"
          title={headerTitle}
          description="Schema에 정의한 필드의 값·근거·페이지를 추출하고 검수합니다. 여러 페이지 문서는 페이지 단위로 처리합니다."
          steps={steps}
          collapseActions
          actions={
            <>
              <Button variant="ghost" icon={<Search size={16} />} onClick={() => setArchiveOpen(true)}>
                아카이브
              </Button>
              <Button
                variant="ghost"
                icon={<History size={16} />}
                onClick={() => {
                  setHistoryOpen(true);
                  void batches.refresh();
                }}
              >
                배치 기록
              </Button>
              <DocumentInput
                variant="button"
                maxFiles={uploadMaxBatchFiles}
                chunkSize={uploadChunkFiles}
                selectedDocuments={selectedDocuments}
                disabled={Boolean(busy)}
                onReady={(documents) => void selectDocuments(documents)}
                onNotice={setNotice}
              />
              <Button
                variant="primary"
                icon={<Play size={16} />}
                disabled={Boolean(busy) || !runCount || (multiPage && !schema.ready)}
                title={
                  multiPage && !schema.ready
                    ? (schema.saveMessage ?? "Schema를 먼저 완성하세요.")
                    : multiPage
                      ? "모든 페이지를 페이지마다 한 항목으로 추출합니다."
                      : undefined
                }
                onClick={run}
              >
                실행
              </Button>
            </>
          }
        />
      }
      alerts={
        busy || notice || error ? (
          <>
            {busy && <InlineAlert busy>{busy}</InlineAlert>}
            {error && (
              <InlineAlert tone="danger" onDismiss={() => setError(null)}>
                {error}
              </InlineAlert>
            )}
            {notice && (
              <InlineAlert tone={notice.tone} onDismiss={() => setNotice(null)}>
                {notice.text}
              </InlineAlert>
            )}
          </>
        ) : null
      }
      statusBar={
        activeBatch ? (
          <JobStatusBar
            eyebrow="배치"
            status={activeBatch.status}
            progress={activeBatch.progress}
            processed={finished}
            total={activeBatch.total_count}
            counters={{
              total: activeBatch.total_count,
              completed: activeBatch.completed_count,
              needsReview: needsReviewCount,
              failed: activeBatch.failed_count
            }}
            onNextReview={() => {
              const reviewItems = activeBatch.items.filter((item) => item.status === "needs_review");
              if (!reviewItems.length) return;
              const index = reviewItems.findIndex((item) => item.id === activeItem?.id);
              review.setFilter("needs_review");
              void openBatchItem(activeBatch, reviewItems[(index + 1) % reviewItems.length].id);
            }}
            exportOptions={batchJobExportOptions(activeBatch.id)}
            exportFooter={<ExportJobHistory ownerType="batch" ownerId={activeBatch.id} compact limit={3} />}
            onResume={
              batchCanResume(activeBatch)
                ? () =>
                    void withBusy("배치 계속 처리 중", async () => {
                      await batches.resume(activeBatch.id);
                      setNotice({ tone: "info", text: "등록된 문서 기준으로 배치 처리를 계속합니다." });
                    })
                : undefined
            }
            onStop={batchCanDiscard(activeBatch) ? () => void stopBatch(activeBatch.id) : undefined}
          />
        ) : null
      }
    >
      <SplitPane
        leftLabel="문서"
        rightLabel="Schema와 검수"
        left={
          <div className={activeBatch ? "ui-document-area with-rail" : "ui-document-area"}>
            {activeBatch && (
              <BatchItemRail
                items={activeBatch.items.map((item) => ({ ...item, label: documentLabel(item.filename, item.page_number) }))}
                activeItemId={activeItem?.id ?? null}
                onOpen={(itemId) => void openBatchItem(activeBatch, itemId)}
              />
            )}
            <div className="ui-document-main">{mainContent}</div>
          </div>
        }
        right={
          <ResponsiveTabs
            label="Schema와 검수"
            defaultTab={result ? "review" : "schema"}
            tabs={[
              { id: "schema", label: "Schema", content: schemaCard },
              { id: "review", label: "검수", content: reviewCard }
            ]}
          />
        }
      />
      <DefinitionListDrawer
        open={schemaListOpen}
        eyebrow="Schema"
        title="Schema 목록"
        newLabel="새 schema"
        items={schema.savedSchemas.map((item) => ({
          id: item.id,
          name: item.display_name || item.name,
          summary: `${item.fields.length}개 필드 · ${item.regions.length}개 영역 · ${formatDate(item.updated_at)}`
        }))}
        activeId={schema.schema?.id ?? null}
        draftName={schema.schema ? null : schema.schemaName || "새 schema"}
        onNew={() => {
          schema.startNew();
          setStep("schema");
          setSchemaListOpen(false);
        }}
        onLoad={(id) =>
          void withBusy("Schema 불러오는 중", async () => {
            batches.close();
            schema.apply(await schema.getCached(id, { force: true }));
            setStep("schema");
            setSchemaListOpen(false);
          })
        }
        onDuplicate={(id) => void withBusy("Schema 복제 중", () => schema.duplicate(id))}
        onDelete={(id) =>
          void (async () => {
            const target = schema.savedSchemas.find((item) => item.id === id);
            const accepted = await confirm({
              title: "Schema 삭제",
              message: `"${target?.display_name || target?.name || id}"을(를) 삭제할까요?`,
              confirmLabel: "삭제",
              tone: "danger"
            });
            if (accepted) await withBusy("Schema 삭제 중", () => schema.remove(id));
          })()
        }
        onClose={() => setSchemaListOpen(false)}
        extra={
          <SchemaListExtras
            schema={schema}
            document={document}
            systemStatus={systemStatus}
            onImport={() => {
              const message = schema.importJson();
              if (message) setError(message);
              else setSchemaListOpen(false);
            }}
            onSaveTemplate={() => void withBusy("템플릿 저장 중", () => schema.markAsTemplate())}
            onLoadTemplate={(template) => {
              schema.loadTemplate(template);
              setSchemaListOpen(false);
            }}
          />
        }
      />
      <ArchiveDialog
        open={archiveOpen}
        query={archiveQuery}
        status={archiveStatus}
        results={archiveQueryResult.data ?? []}
        onQuery={setArchiveQuery}
        onStatus={setArchiveStatus}
        onOpen={(item) => {
          setArchiveOpen(false);
          void (item.job_id ? withBusy("추출 결과 불러오는 중", () => loadJob(item.job_id as string)) : openLibraryDocument(item.document_id));
        }}
        onClose={() => setArchiveOpen(false)}
      />
      <BatchHistoryDrawer
        open={historyOpen}
        batches={batches.batches}
        activeBatchId={batches.activeBatchId}
        onOpen={(batch) => {
          setHistoryOpen(false);
          setSelectedDocuments([]);
          void withBusy("배치 불러오는 중", () => openBatch(batch.id));
        }}
        onClose={() => setHistoryOpen(false)}
      />
      {pendingRecommendation && (
        <RecommendationDiffDialog
          currentFields={schema.fields}
          recommendation={pendingRecommendation}
          onApply={() => {
            schema.applyRecommendation(pendingRecommendation);
            setPendingRecommendation(null);
            setStep("schema");
          }}
          onCancel={() => setPendingRecommendation(null)}
        />
      )}
    </ModulePage>
  );
}
