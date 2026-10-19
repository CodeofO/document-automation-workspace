import { Play, RotateCw } from "lucide-react";
import { useState } from "react";
import { toFriendlyError } from "../../api/client";
import type { LibraryDocument } from "../../api/types";
import {
  Button,
  Card,
  EmptyState,
  InlineAlert,
  JobStatusBar,
  ModulePage,
  PageHeader,
  SplitPane,
  StatusBadge,
  type AlertTone,
  type ExportMenuOption
} from "../../components/ui";
import { downloadCsv, downloadJson } from "../../lib/download";
import { summarizeDocuments } from "../../lib/files";
import { formatDateTime } from "../../lib/format";
import { isActiveStatus } from "../../lib/status";
import { DocumentInput, LibraryDocumentSelectionPreview } from "../library";
import { cancelRotationBatch, createRotationBatch, rotateDocumentPage } from "./api";
import { RotationHistory } from "./components/RotationHistory";
import { RotationResultGrid } from "./components/RotationResultGrid";
import { useRotationBatches } from "./hooks/useRotationBatches";
import { applyManualRotation, rotationBatchStatusLabel, rotationCounterItems, rotationPageKey } from "./model";
import type { ManualRotationDegrees, ManualRotationState, RotationBatch } from "./types";

type Notice = { tone: AlertTone; text: string };

function selectedNotice(count: number): Notice {
  return { tone: "info", text: `${count.toLocaleString()}개 보관 문서를 선택했습니다.` };
}

/** 보정 결과(페이지별 감지·보정) JSON/CSV. 서버 export job이 없어 브라우저에서 만든다. */
function rotationExportOptions(batch: RotationBatch): ExportMenuOption[] {
  const stamp = batch.created_at.slice(0, 19).replace(/[:T]/g, "-");
  return [
    {
      format: "json",
      onExport: () =>
        downloadJson(`rotation-${stamp}.json`, {
          batch_id: batch.id,
          status: batch.status,
          created_at: batch.created_at,
          items: batch.items.map((item) => ({
            document_id: item.document_id,
            filename: item.filename,
            page_number: item.page_number ?? null,
            status: item.status,
            error_message: item.error_message,
            pages: item.pages
          }))
        })
    },
    {
      format: "csv",
      onExport: () =>
        downloadCsv(
          `rotation-${stamp}.csv`,
          batch.items.flatMap((item) =>
            item.pages.map((page) => ({
              filename: item.filename,
              document_id: item.document_id,
              page_number: page.page_number,
              status: page.status,
              detected_rotation: page.detected_rotation,
              correction: page.correction,
              applied: page.applied,
              confidence: page.confidence,
              reason: page.reason
            }))
          )
        )
    }
  ];
}

/**
 * 회전 보정 화면. 공용 규칙대로 왼쪽은 문서(입력·선택·결과 그리드), 오른쪽은 실행 정보·기록.
 */
export function RotationWorkspace(props: {
  uploadChunkFiles: number;
  uploadMaxBatchFiles: number;
  initialLibraryDocuments?: LibraryDocument[];
  initialBatchId?: string | null;
}) {
  // 보관함에서 넘겨받은 문서는 마운트할 때 한 번만 선택으로 쓴다.
  const [selectedDocuments, setSelectedDocuments] = useState<LibraryDocument[]>(() => props.initialLibraryDocuments ?? []);
  const [notice, setNotice] = useState<Notice | null>(() =>
    props.initialLibraryDocuments?.length ? selectedNotice(props.initialLibraryDocuments.length) : null
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [manualRotations, setManualRotations] = useState<ManualRotationState>({});
  const [rotatingKey, setRotatingKey] = useState<string | null>(null);
  const batches = useRotationBatches(props.initialBatchId ?? null);
  const { activeBatch } = batches;
  const openError = batches.openError ? toFriendlyError(batches.openError) : null;

  function selectDocuments(documents: LibraryDocument[]) {
    setSelectedDocuments(documents);
    if (documents.length) batches.clearActiveBatch();
    setNotice(documents.length ? selectedNotice(documents.length) : null);
  }

  async function run() {
    if (!selectedDocuments.length) {
      setNotice({ tone: "warning", text: "회전 보정할 문서를 추가하거나 보관함에서 선택하세요." });
      return;
    }
    setBusy("회전 보정 작업을 생성하는 중");
    setNotice(null);
    try {
      const batch = await createRotationBatch(selectedDocuments.map((document) => document.document_id));
      batches.showNewBatch(batch);
      setManualRotations({});
      setNotice({
        tone: "success",
        text: `${selectedDocuments.length.toLocaleString()}개 보관 문서의 회전 보정을 시작했습니다. 변환 중인 문서는 준비되면 자동 실행됩니다.`
      });
      setSelectedDocuments([]);
    } catch (err) {
      setNotice({ tone: "danger", text: toFriendlyError(err) });
    } finally {
      setBusy(null);
    }
  }

  async function stopBatch() {
    if (!activeBatch) return;
    try {
      batches.applyBatchUpdate(await cancelRotationBatch(activeBatch.id));
      setNotice({ tone: "info", text: "회전 보정 중단을 요청했습니다. 이미 보정된 페이지는 유지됩니다." });
      batches.refreshRecentAfterCancel();
    } catch (err) {
      setNotice({ tone: "danger", text: toFriendlyError(err) });
    }
  }

  async function rotatePage(documentId: string, pageNumber: number, degrees: ManualRotationDegrees) {
    const key = rotationPageKey(documentId, pageNumber);
    setRotatingKey(key);
    try {
      const serverRotation = await rotateDocumentPage(documentId, pageNumber, degrees);
      setManualRotations((current) => applyManualRotation(current, key, degrees, serverRotation));
    } catch (err) {
      setNotice({ tone: "danger", text: toFriendlyError(err) });
    } finally {
      setRotatingKey(null);
    }
  }

  const counters = activeBatch ? rotationCounterItems(activeBatch) : [];
  const headerTitle = selectedDocuments.length
    ? selectedDocuments.length === 1
      ? selectedDocuments[0].filename
      : summarizeDocuments(selectedDocuments)
    : activeBatch
      ? `${formatDateTime(activeBatch.created_at)} 실행 · ${activeBatch.total_count.toLocaleString()}개 항목`
      : "문서를 선택하세요";

  const left = activeBatch ? (
    <RotationResultGrid
      key={activeBatch.id}
      batch={activeBatch}
      terminal={batches.activeTerminal}
      manualRotations={manualRotations}
      rotatingKey={rotatingKey}
      onRotate={(documentId, pageNumber, degrees) => void rotatePage(documentId, pageNumber, degrees)}
    />
  ) : selectedDocuments.length ? (
    <LibraryDocumentSelectionPreview documents={selectedDocuments} onClear={() => selectDocuments([])} />
  ) : (
    <DocumentInput
      variant="zone"
      maxFiles={props.uploadMaxBatchFiles}
      chunkSize={props.uploadChunkFiles}
      onReady={selectDocuments}
      onNotice={setNotice}
      description="PDF·이미지·Office 문서를 올리면 보관함에 저장한 뒤 페이지마다 방향을 감지합니다."
    />
  );

  const right = (
    <div className="ui-side-stack">
      <Card
        className="rotation-result-card"
        eyebrow="결과"
        title={activeBatch ? rotationBatchStatusLabel(activeBatch.status) : "실행 대기"}
      >
        {activeBatch ? (
          <dl className="ui-summary-list">
            {counters.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd data-tone={item.tone}>{item.value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <EmptyState compact icon={<RotateCw size={28} />} title="문서를 고르고 실행하세요.">
            페이지별 감지 결과와 보정 후 이미지를 왼쪽에서 확인하고, 필요하면 직접 돌릴 수 있습니다.
          </EmptyState>
        )}
        <ul className="ui-legend" aria-label="배지 설명">
          <li>
            <StatusBadge status="completed" tone="success" label="90° 보정됨" /> 감지한 방향으로 돌림
          </li>
          <li>
            <StatusBadge status="needs_review" label="검토 필요" /> 확신이 낮아 그대로 둠
          </li>
          <li>
            <StatusBadge status="queued" tone="neutral" label="정방향" /> 변경 없음
          </li>
        </ul>
      </Card>
      <RotationHistory
        batches={batches.recentBatches}
        activeBatchId={activeBatch?.id ?? null}
        onOpen={(batchId) => {
          setNotice(null);
          setSelectedDocuments([]);
          batches.openBatch(batchId);
        }}
        onRefresh={batches.refreshRecent}
      />
    </div>
  );

  return (
    <ModulePage
      module="rotation"
      header={
        <PageHeader
          eyebrow="회전 보정"
          title={headerTitle}
          description="90°·180°·270° 돌아간 페이지를 감지해 보관함의 페이지 이미지를 정방향으로 돌립니다. 원본 파일은 유지됩니다."
          steps={[
            { label: "문서", active: !selectedDocuments.length && !activeBatch, done: Boolean(selectedDocuments.length || activeBatch) },
            { label: "실행", active: Boolean(busy) || isActiveStatus(activeBatch?.status), done: Boolean(activeBatch) },
            { label: "검토", active: batches.activeTerminal && Boolean(activeBatch), done: false }
          ]}
          collapseActions
          actions={
            <>
              <DocumentInput
                variant="button"
                maxFiles={props.uploadMaxBatchFiles}
                chunkSize={props.uploadChunkFiles}
                selectedDocuments={selectedDocuments}
                disabled={Boolean(busy)}
                onReady={selectDocuments}
                onNotice={setNotice}
              />
              <Button
                variant="primary"
                icon={<Play size={16} />}
                disabled={Boolean(busy) || !selectedDocuments.length}
                onClick={() => void run()}
              >
                실행
              </Button>
            </>
          }
        />
      }
      alerts={
        busy || notice || openError ? (
          <>
            {busy && <InlineAlert busy>{busy}</InlineAlert>}
            {notice && (
              <InlineAlert tone={notice.tone} onDismiss={() => setNotice(null)}>
                {notice.text}
              </InlineAlert>
            )}
            {openError && <InlineAlert tone="danger">{openError}</InlineAlert>}
          </>
        ) : null
      }
      statusBar={
        activeBatch ? (
          <JobStatusBar
            eyebrow="회전 보정"
            status={activeBatch.status}
            progress={activeBatch.progress}
            processed={activeBatch.completed_count + activeBatch.failed_count + activeBatch.canceled_count + (activeBatch.needs_review_count ?? 0)}
            total={activeBatch.total_count}
            counters={{
              total: activeBatch.total_count,
              completed: activeBatch.completed_count,
              needsReview: counters[2]?.value ?? 0,
              failed: activeBatch.failed_count,
              extra: counters.slice(4)
            }}
            exportOptions={rotationExportOptions(activeBatch)}
            onStop={batches.activeTerminal ? undefined : () => void stopBatch()}
            stopDisabled={activeBatch.status === "canceling"}
          />
        ) : null
      }
    >
      <SplitPane leftLabel="문서" rightLabel="실행 정보" left={<div className="ui-document-main">{left}</div>} right={right} />
    </ModulePage>
  );
}

