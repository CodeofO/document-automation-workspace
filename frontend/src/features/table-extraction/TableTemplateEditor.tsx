// 표 양식(TableTemplate) 편집기(설계 §7-2). KIE schema 편집에 해당한다.
// 왼쪽: 샘플 이미지(1~3장) 위에 표 스키마마다 색이 다른 영역 상자를 동시에 그리고 옮긴다.
// 오른쪽: 양식 이름·설명, 표 스키마 탭 + 선택한 표 설정·칼럼·규칙, [AI로 칼럼 초안] [미리보기]. 변경은 자동 저장.
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Archive, Copy, Eye, Library, Play, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router";
import { documentPageImageUrl, isAbortError, toFriendlyError } from "../../api/client";
import { tablesPath, tableTemplatePath } from "../../app/routes";
import { MultiRegionEditor, type RegionBox } from "../../components/document/MultiRegionEditor";
import {
  AutoTextarea,
  Button,
  Card,
  DefinitionListDrawer,
  Drawer,
  EmptyState,
  IconButton,
  InlineAlert,
  ModulePage,
  PageHeader,
  SaveIndicator,
  SplitPane,
  StatusBadge,
  useConfirm
} from "../../components/ui";
import { documentLabel } from "../../lib/format";
import { isTerminalStatus } from "../../lib/status";
import { DocumentInput, DocumentPickerDialog, useDocumentDetail, type LibraryDocument } from "../library";
import { useUploadLimits } from "../settings";
import {
  archiveTableTemplate,
  createDraftTableJob,
  duplicateTableTemplate,
  recommendTableSpec,
  useTableTemplate,
  useTableTemplates,
  waitForTableJob,
  writeTemplateCache
} from "./api";
import { TableResultTabs } from "./components/TableResultTabs";
import { TableSpecEditor } from "./components/TableSpecEditor";
import { useTemplateDraft } from "./hooks/useTemplateDraft";
import { regionColorVar } from "./model/regions";
import { effectiveTables } from "./model/results";
import {
  MAX_SAMPLES,
  MAX_TABLES,
  emptyTemplateDraft,
  moveItem,
  newTableSpec,
  normalizeSpecFromServer,
  specToPayload,
  tableSpecError,
  templateLabel,
  templateSummary
} from "./model/template";
import type { TableExtractionJob, TableSpec } from "./types";

type Notice = { tone: "info" | "success" | "warning" | "danger"; text: string };

export function TableTemplateEditorPage() {
  const params = useParams();
  const routeTemplateId = params.templateId ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { uploadMaxBatchFiles, uploadChunkFiles } = useUploadLimits();
  const templatesQuery = useTableTemplates();
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const templateQuery = useTableTemplate(routeTemplateId);
  const loadedTemplate = routeTemplateId ? (templateQuery.data ?? null) : null;
  const existingNames = templates.map((item) => item.name);

  const template = useTemplateDraft({
    template: loadedTemplate,
    newDraft: () => emptyTemplateDraft(existingNames),
    onCreated: (saved) => navigate(tableTemplatePath(saved.id), { replace: true })
  });
  const { draft } = template;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerIds, setPickerIds] = useState<string[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ job: TableExtractionJob; label: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTableKey, setPreviewTableKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return () => controller.abort();
  }, []);

  const tables = draft.tables;
  const activeIndex = Math.min(selectedIndex, Math.max(0, tables.length - 1));
  const activeSpec: TableSpec | undefined = tables[activeIndex];
  const samples = draft.sample_refs;
  const activeSampleIndex = Math.min(sampleIndex, Math.max(0, samples.length - 1));
  const sample = samples[activeSampleIndex] ?? null;
  const sampleDocQuery = useDocumentDetail(sample?.document_id ?? null);
  const sampleDoc = sample ? (sampleDocQuery.data ?? null) : null;
  const sampleReady = sampleDoc?.status === "ready" || (sampleDoc && sampleDoc.pages.length > 0);
  const sampleImageUrl = sample && sampleReady ? documentPageImageUrl(sample.document_id, sample.page_number) : null;
  const notFound = Boolean(routeTemplateId && templateQuery.isError);

  function setTables(next: TableSpec[]) {
    template.update((current) => ({ ...current, tables: next }));
  }

  function updateSpec(index: number, spec: TableSpec) {
    setTables(tables.map((item, itemIndex) => (itemIndex === index ? spec : item)));
  }

  async function runTask(label: string, task: () => Promise<void>) {
    setBusy(label);
    setNotice(null);
    try {
      await task();
    } catch (exc) {
      if (!isAbortError(exc)) setNotice({ tone: "danger", text: toFriendlyError(exc) });
    } finally {
      setBusy(null);
    }
  }

  // ---- 표 스키마 ----

  function addTable() {
    if (tables.length >= MAX_TABLES) {
      setNotice({ tone: "warning", text: `표는 양식마다 ${MAX_TABLES}개까지 만들 수 있습니다.` });
      return;
    }
    setTables([...tables, newTableSpec(tables)]);
    setSelectedIndex(tables.length);
  }

  async function removeTable(index: number) {
    const spec = tables[index];
    if (!spec) return;
    const accepted = await confirm({
      title: "표 삭제",
      message: `"${spec.name || spec.key}" 표와 칼럼·영역을 양식에서 뺍니다.`,
      confirmLabel: "삭제",
      tone: "danger"
    });
    if (!accepted) return;
    setTables(tables.filter((_, itemIndex) => itemIndex !== index));
    setSelectedIndex(Math.max(0, index - 1));
  }

  function moveTable(index: number, delta: number) {
    setTables(moveItem(tables, index, delta));
    setSelectedIndex(Math.max(0, Math.min(tables.length - 1, index + delta)));
  }

  // ---- 샘플 ----

  function addSamples(documents: LibraryDocument[]) {
    const known = new Set(samples.map((item) => `${item.document_id}:${item.page_number}`));
    const added = documents
      .map((document) => ({ document_id: document.document_id, page_number: 1 }))
      .filter((item) => !known.has(`${item.document_id}:${item.page_number}`));
    const room = MAX_SAMPLES - samples.length;
    if (!added.length) return;
    if (added.length > room) {
      setNotice({
        tone: "warning",
        text: `샘플은 ${MAX_SAMPLES}장까지 둘 수 있습니다. 앞의 ${Math.max(0, room)}개만 추가했습니다.`
      });
    }
    const next = [...samples, ...added.slice(0, Math.max(0, room))];
    template.update((current) => ({ ...current, sample_refs: next }));
    setSampleIndex(Math.max(0, samples.length));
  }

  function removeSample(index: number) {
    template.update((current) => ({
      ...current,
      sample_refs: current.sample_refs.filter((_, itemIndex) => itemIndex !== index)
    }));
    setSampleIndex(Math.max(0, index - 1));
  }

  function setSamplePage(pageNumber: number) {
    template.update((current) => ({
      ...current,
      sample_refs: current.sample_refs.map((item, itemIndex) =>
        itemIndex === activeSampleIndex ? { ...item, page_number: pageNumber } : item
      )
    }));
  }

  // ---- AI 초안 · 미리보기 ----

  function recommendColumns() {
    if (!activeSpec || !sample) {
      setNotice({ tone: "warning", text: "샘플 이미지를 추가하고 표 영역을 그린 뒤 사용하세요." });
      return;
    }
    const spec = activeSpec;
    const index = activeIndex;
    void runTask("AI가 칼럼 초안을 만드는 중", async () => {
      const recommendation = await recommendTableSpec({
        document_id: sample.document_id,
        page_number: sample.page_number,
        region: spec.region,
        table_description: spec.description
      });
      const suggested = normalizeSpecFromServer(recommendation.table);
      const hasCustomColumns = spec.columns.some((column) => column.key && !/^칼럼\d+$/.test(column.key));
      if (hasCustomColumns) {
        const accepted = await confirm({
          title: "칼럼 바꾸기",
          message: `AI 초안 칼럼 ${suggested.columns.length}개로 지금 칼럼을 바꿀까요?`,
          confirmLabel: "바꾸기"
        });
        if (!accepted) return;
      }
      updateSpec(index, {
        ...spec,
        columns: suggested.columns,
        end_hint: spec.end_hint || suggested.end_hint,
        row_unit_hint: spec.row_unit_hint || suggested.row_unit_hint,
        description: spec.description || suggested.description,
        row_count: spec.row_count.mode === "unknown" ? suggested.row_count : spec.row_count,
        rules: []
      });
      setNotice({
        tone: "success",
        text: `AI 칼럼 초안 ${suggested.columns.length}개를 넣었습니다. 확인 후 고치세요.${recommendation.reasoning ? ` (${recommendation.reasoning})` : ""}`
      });
    });
  }

  function runPreview(onlyActive: boolean) {
    if (!sample) {
      setNotice({ tone: "warning", text: "미리보기할 샘플 이미지를 먼저 추가하세요." });
      return;
    }
    const targets = onlyActive && activeSpec ? [activeSpec] : tables;
    if (!targets.length) {
      setNotice({ tone: "warning", text: "표를 하나 이상 추가하세요." });
      return;
    }
    const error = targets.map(tableSpecError).find(Boolean);
    if (error) {
      setNotice({ tone: "warning", text: error });
      return;
    }
    const label = onlyActive && activeSpec ? activeSpec.name : "전체 표";
    void runTask(`${label} 미리보기 실행 중`, async () => {
      const created = await createDraftTableJob({
        document_id: sample.document_id,
        page_number: sample.page_number,
        definition: { name: draft.name, tables: tables.map(specToPayload) },
        table_keys: targets.map((spec) => spec.key.trim())
      });
      setPreview({ job: created, label });
      setPreviewTableKey(targets[0]?.key ?? null);
      setPreviewOpen(true);
      const done = await waitForTableJob(created.job_id, {
        signal: abortRef.current?.signal,
        onProgress: (job) => setPreview({ job, label })
      });
      setPreview({ job: done, label });
      if (done.status === "failed")
        setNotice({ tone: "danger", text: done.error_message || "미리보기에 실패했습니다." });
    });
  }

  // ---- 목록 ----

  async function archiveTemplate(id: string) {
    const target = templates.find((item) => item.id === id);
    const accepted = await confirm({
      title: "양식 보관",
      message: `"${target ? templateLabel(target) : "양식"}"을(를) 보관합니다. 목록과 실행에서 빠지고, 이미 끝난 결과는 남습니다.`,
      confirmLabel: "보관",
      tone: "danger"
    });
    if (!accepted) return;
    await runTask("양식 보관 중", async () => {
      const archived = await archiveTableTemplate(id);
      writeTemplateCache(queryClient, archived);
      if (id === template.templateId) {
        template.reset();
        navigate(tableTemplatePath(), { replace: true });
      }
      setNotice({ tone: "info", text: "양식을 보관했습니다." });
    });
  }

  function duplicate(id: string) {
    void runTask("양식 복제 중", async () => {
      const copy = await duplicateTableTemplate(id);
      writeTemplateCache(queryClient, copy);
      setListOpen(false);
      navigate(tableTemplatePath(copy.id));
      setNotice({ tone: "success", text: `"${copy.name}"으로 복제했습니다.` });
    });
  }

  function openRunScreen() {
    void runTask("양식을 저장하는 중", async () => {
      const id = await template.flush();
      navigate(tablesPath({ template: id }));
    });
  }

  // ---- 화면 ----

  const boxes: RegionBox[] = tables.map((spec, index) => ({
    id: String(index),
    label: spec.name || spec.key,
    color: regionColorVar(index),
    region: spec.region
  }));
  const pageCount = Math.max(1, sampleDoc?.page_count ?? 1);
  const previewTables = preview?.job.result ? effectiveTables(preview.job.result) : [];

  const samplePanel = (
    <div className="table-sample-panel">
      <div className="pane-header ui-viewer-header table-sample-header">
        <div className="ui-viewer-title">
          <p className="eyebrow">
            샘플 이미지 · {samples.length}/{MAX_SAMPLES}
          </p>
          <h2>{sampleDoc && sample ? documentLabel(sampleDoc.filename, sample.page_number) : "샘플을 추가하세요"}</h2>
        </div>
        <div className="ui-viewer-toolbar">
          {samples.length > 0 && (
            <div className="table-sample-tabs" role="tablist" aria-label="샘플">
              {samples.map((item, index) => (
                <button
                  key={`${item.document_id}-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={index === activeSampleIndex}
                  className={index === activeSampleIndex ? "active" : ""}
                  onClick={() => setSampleIndex(index)}
                >
                  샘플 {index + 1}
                </button>
              ))}
            </div>
          )}
          {sampleDoc && pageCount > 1 && (
            <select
              aria-label="샘플 페이지"
              value={sample?.page_number ?? 1}
              onChange={(event) => setSamplePage(Number(event.target.value))}
            >
              {Array.from({ length: pageCount }, (_, index) => (
                <option key={index} value={index + 1}>
                  {index + 1}페이지
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            icon={<Plus size={14} />}
            disabled={samples.length >= MAX_SAMPLES}
            onClick={() => {
              setPickerIds([]);
              setPickerOpen(true);
            }}
          >
            샘플 추가
          </Button>
          {sample && (
            <IconButton size="sm" variant="ghost" label="이 샘플 빼기" onClick={() => removeSample(activeSampleIndex)}>
              <X size={16} />
            </IconButton>
          )}
        </div>
      </div>
      {sample ? (
        <>
          <p className="table-sample-hint">
            {activeSpec && !activeSpec.region
              ? `"${activeSpec.name || activeSpec.key}" 영역을 이미지 위에서 끌어 그리세요.`
              : "상자를 눌러 표를 고르고, 끌어서 옮기거나 모서리로 크기를 바꾸세요. 방향키로도 옮길 수 있습니다."}
          </p>
          <div className="table-sample-stage">
            <MultiRegionEditor
              imageUrl={sampleImageUrl}
              imageAlt={sampleDoc ? documentLabel(sampleDoc.filename, sample.page_number) : "샘플"}
              boxes={boxes}
              selectedId={activeSpec ? String(activeIndex) : null}
              drawId={activeSpec && !activeSpec.region ? String(activeIndex) : null}
              onSelect={(id) => setSelectedIndex(Number(id))}
              onChange={(id, region) => {
                const index = Number(id);
                const spec = tables[index];
                if (spec) updateSpec(index, { ...spec, region });
              }}
              emptyText={
                sampleDocQuery.isError ? "샘플 문서를 불러오지 못했습니다." : "샘플 페이지를 준비하는 중입니다."
              }
            />
          </div>
        </>
      ) : (
        <DocumentInput
          variant="zone"
          multiple
          maxFiles={Math.min(MAX_SAMPLES, uploadMaxBatchFiles)}
          chunkSize={uploadChunkFiles}
          title="샘플 이미지를 추가하세요"
          description="표 영역을 그릴 같은 양식의 이미지·PDF를 1~3장 고릅니다. 올린 파일은 보관함에 저장됩니다."
          onReady={addSamples}
          onNotice={(next) => setNotice(next ? { tone: next.tone, text: next.text } : null)}
        />
      )}
    </div>
  );

  const templateCard = (
    <Card
      className="table-template-card"
      eyebrow="표 양식"
      title={draft.name || "이름 없는 양식"}
      actions={
        <>
          <SaveIndicator state={template.saveState} message={template.saveMessage} />
          <Button size="sm" icon={<Library size={15} />} onClick={() => setListOpen(true)}>
            목록
          </Button>
        </>
      }
    >
      {template.saveMessage && template.saveState !== "saved" && (
        <InlineAlert tone={template.saveState === "error" ? "danger" : "warning"}>{template.saveMessage}</InlineAlert>
      )}
      <div className="ui-form-grid">
        <label className="ui-field">
          <span>양식 이름</span>
          <input
            aria-label="양식 이름"
            value={draft.name}
            onChange={(event) => template.update((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="ui-field">
          <span>설명</span>
          <AutoTextarea
            aria-label="양식 설명"
            placeholder="예: 생산 일지(투입 내역·성분 분석·작업 시각표)"
            value={draft.description}
            onChange={(event) => template.update((current) => ({ ...current, description: event.target.value }))}
          />
        </label>
      </div>
    </Card>
  );

  const specCard = (
    <Card
      className="table-spec-card"
      eyebrow={`표 스키마 · ${tables.length}개`}
      title={activeSpec ? activeSpec.name || activeSpec.key : "표를 추가하세요"}
      actions={
        <>
          <Button
            size="sm"
            icon={<Sparkles size={14} />}
            disabled={!activeSpec || Boolean(busy)}
            onClick={recommendColumns}
          >
            AI로 칼럼 초안
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Eye size={14} />}
            disabled={!activeSpec || Boolean(busy)}
            title="지금 샘플 페이지에서 이 표만 읽어 봅니다(저장하지 않은 정의로)."
            onClick={() => runPreview(true)}
          >
            미리보기
          </Button>
        </>
      }
    >
      <div className="table-spec-tabs" role="tablist" aria-label="표 스키마">
        {tables.map((spec, index) => (
          <button
            key={`${index}-${spec.key}`}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? "active" : ""}
            style={{ "--region-color": regionColorVar(index) } as CSSProperties}
            onClick={() => setSelectedIndex(index)}
          >
            <span className="table-region-swatch" aria-hidden />
            {spec.name || spec.key}
            <small>{spec.columns.length}칼럼</small>
          </button>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={addTable}>
          표 추가
        </Button>
        {activeSpec && (
          <span className="table-spec-tab-tools">
            <IconButton
              size="sm"
              variant="ghost"
              label="표를 앞으로"
              disabled={activeIndex === 0}
              onClick={() => moveTable(activeIndex, -1)}
            >
              <ArrowLeft size={14} />
            </IconButton>
            <IconButton
              size="sm"
              variant="ghost"
              label="표를 뒤로"
              disabled={activeIndex >= tables.length - 1}
              onClick={() => moveTable(activeIndex, 1)}
            >
              <ArrowRight size={14} />
            </IconButton>
            <IconButton
              size="sm"
              variant="danger-ghost"
              label="이 표 삭제"
              onClick={() => void removeTable(activeIndex)}
            >
              <Trash2 size={14} />
            </IconButton>
          </span>
        )}
      </div>
      {activeSpec ? (
        <TableSpecEditor
          spec={activeSpec}
          colorVar={regionColorVar(activeIndex)}
          onChange={(spec) => updateSpec(activeIndex, spec)}
        />
      ) : (
        <EmptyState
          compact
          title="아직 표가 없습니다."
          action={
            <Button variant="primary" icon={<Plus size={16} />} onClick={addTable}>
              표 추가
            </Button>
          }
        >
          한 페이지에 표가 여럿이면 표마다 하나씩 추가하고 영역을 그립니다.
        </EmptyState>
      )}
    </Card>
  );

  return (
    <ModulePage
      module="table-template"
      header={
        <PageHeader
          eyebrow="표 추출 · 양식 편집"
          title={draft.name || "새 표 양식"}
          description={`${templateSummary(draft)} · 샘플 이미지에 표 영역을 그리고 칼럼을 정의합니다. 변경은 자동 저장됩니다.`}
          collapseActions
          actions={
            <>
              {template.templateId && (
                <>
                  <Button
                    icon={<Copy size={16} />}
                    disabled={Boolean(busy)}
                    onClick={() => duplicate(template.templateId as string)}
                  >
                    복제
                  </Button>
                  <Button
                    icon={<Archive size={16} />}
                    disabled={Boolean(busy)}
                    onClick={() => void archiveTemplate(template.templateId as string)}
                  >
                    보관
                  </Button>
                </>
              )}
              <Button
                icon={<Eye size={16} />}
                disabled={!tables.length || !sample || Boolean(busy)}
                onClick={() => runPreview(false)}
              >
                전체 미리보기
              </Button>
              <Button
                variant="primary"
                icon={<Play size={16} />}
                disabled={Boolean(busy) || Boolean(template.validationMessage)}
                onClick={openRunScreen}
              >
                이 양식으로 실행
              </Button>
            </>
          }
        />
      }
      alerts={
        busy || notice || notFound ? (
          <>
            {busy && <InlineAlert busy>{busy}</InlineAlert>}
            {notice && (
              <InlineAlert tone={notice.tone} onDismiss={() => setNotice(null)}>
                {notice.text}
              </InlineAlert>
            )}
            {notFound && (
              <InlineAlert tone="danger">
                양식을 찾지 못했습니다. 목록에서 다른 양식을 고르거나 새로 만드세요.
              </InlineAlert>
            )}
          </>
        ) : null
      }
    >
      <SplitPane
        storageKey="table_template_split_v1"
        defaultPercent={50}
        leftLabel="샘플 이미지"
        rightLabel="표 스키마"
        left={samplePanel}
        right={
          <div className="ui-side-stack">
            {templateCard}
            {specCard}
          </div>
        }
      />
      <DocumentPickerDialog
        open={pickerOpen}
        uploadChunkFiles={uploadChunkFiles}
        selectedIds={pickerIds}
        onSelectedIds={(ids) => setPickerIds(ids.slice(-Math.max(1, MAX_SAMPLES - samples.length)))}
        onClose={() => setPickerOpen(false)}
        onApply={(documents) => {
          addSamples(documents);
          setPickerOpen(false);
        }}
      />
      <DefinitionListDrawer
        open={listOpen}
        eyebrow="표 추출"
        title="표 양식 목록"
        newLabel="새 표 양식"
        items={templates.map((item) => ({ id: item.id, name: templateLabel(item), summary: templateSummary(item) }))}
        activeId={template.templateId}
        draftName={template.templateId ? null : draft.name || "새 표 양식"}
        onNew={() => {
          setListOpen(false);
          template.reset();
          setSelectedIndex(0);
          setSampleIndex(0);
          navigate(tableTemplatePath());
        }}
        onLoad={(id) => {
          setListOpen(false);
          setSelectedIndex(0);
          setSampleIndex(0);
          navigate(tableTemplatePath(id));
        }}
        onDuplicate={duplicate}
        onDelete={(id) => void archiveTemplate(id)}
        onClose={() => setListOpen(false)}
      />
      <Drawer
        open={previewOpen && Boolean(preview)}
        eyebrow={`미리보기 · ${preview?.label ?? ""}`}
        title={
          <span className="table-preview-title">
            {sampleDoc && sample ? documentLabel(sampleDoc.filename, sample.page_number) : "미리보기"}
            {preview && <StatusBadge status={preview.job.status} />}
          </span>
        }
        width="min(900px, 92vw)"
        onClose={() => setPreviewOpen(false)}
      >
        {preview && !isTerminalStatus(preview.job.status) && (
          <InlineAlert busy>표를 읽는 중입니다. 표마다 따로 호출합니다.</InlineAlert>
        )}
        {preview?.job.error_message && <InlineAlert tone="danger">{preview.job.error_message}</InlineAlert>}
        {previewTables.length > 0 && (
          <TableResultTabs
            tables={previewTables}
            orderOf={(key) =>
              Math.max(
                0,
                tables.findIndex((spec) => spec.key === key)
              )
            }
            activeKey={previewTableKey}
            onActiveKey={setPreviewTableKey}
            pending={null}
            selectedRowId={null}
            onSelectRow={() => undefined}
            editable={false}
          />
        )}
        <p className="ui-field-note">
          미리보기는 저장하지 않은 정의로 한 번 실행한 결과입니다(목록·검토 화면에 남지 않음).
        </p>
      </Drawer>
    </ModulePage>
  );
}
