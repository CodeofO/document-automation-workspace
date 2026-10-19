import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toFriendlyError } from "../../api/client";
import type { RawExtraction } from "../../api/types";
import {
  Card,
  EmptyState,
  InlineAlert,
  ModulePage,
  PageHeader,
  SplitPane,
  StatusBadge,
  type AlertTone
} from "../../components/ui";
import { formatDate } from "../../lib/format";
import { DocumentInput, useHandedOffDocuments, type LibraryDocument } from "../library";
import { useUploadLimits } from "../settings";
import {
  createRawExtractionFromDocument,
  getRawExtraction,
  lastRawExtraction,
  listRecentRawExtractions,
  rawAssetUrl,
  rawKeys,
  type RawExtractionOptions
} from "./api";

type Notice = { tone: AlertTone; text: string };

/**
 * 원문 데이터 추출 화면 (/raw). 다른 모듈과 같은 뼈대: 왼쪽 문서(PDF 미리보기·입력), 오른쪽 옵션·HTML 결과·기록.
 * 업로드는 DocumentInput(단일 파일)이 보관함에 올리고, 추출은 보관함 문서 id로 요청한다.
 */
export function RawExtractionPage() {
  const queryClient = useQueryClient();
  const { uploadChunkFiles } = useUploadLimits();
  const handedOff = useHandedOffDocuments("raw");
  const [rawExtraction, setRawExtraction] = useState<RawExtraction | null>(null);
  const [options, setOptions] = useState<RawExtractionOptions>({ includeImages: true, includeFormulas: false });
  const [busy, setBusy] = useState<string | null>(() => (handedOff.length ? "원문 데이터 추출 중" : null));
  const [notice, setNotice] = useState<Notice | null>(null);
  const recentQuery = useQuery({ queryKey: rawKeys.recent, queryFn: listRecentRawExtractions });
  const startedRef = useRef(false);
  const pdfUrl = rawAssetUrl(rawExtraction?.pdf_url);
  const htmlUrl = rawAssetUrl(rawExtraction?.html_url);

  function showExtraction(extraction: RawExtraction) {
    setRawExtraction(extraction);
    lastRawExtraction.write({ raw_id: extraction.id });
    if (extraction.status === "failed") {
      setNotice({ tone: "danger", text: extraction.error_message || "원문 데이터 추출에 실패했습니다." });
    }
  }

  async function run(label: string, task: () => Promise<RawExtraction>) {
    setBusy(label);
    setNotice(null);
    try {
      showExtraction(await task());
      await queryClient.invalidateQueries({ queryKey: rawKeys.recent });
    } catch (err) {
      setNotice({ tone: "danger", text: toFriendlyError(err) });
    } finally {
      setBusy(null);
    }
  }

  function extract(documents: LibraryDocument[]) {
    const [document] = documents;
    if (!document) return;
    void run("원문 데이터 추출 중", () => createRawExtractionFromDocument(document.document_id, options));
  }

  // 처음 들어올 때: 보관함에서 넘겨받은 문서가 있으면 바로 추출하고, 없으면 마지막 결과를 복원한다.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const [document] = handedOff;
    if (document) {
      createRawExtractionFromDocument(document.document_id, { includeImages: true, includeFormulas: false })
        .then(
          (extraction) => {
            showExtraction(extraction);
            return queryClient.invalidateQueries({ queryKey: rawKeys.recent });
          },
          (err) => setNotice({ tone: "danger", text: toFriendlyError(err) })
        )
        .finally(() => setBusy(null));
      return;
    }
    const saved = lastRawExtraction.read();
    if (saved) getRawExtraction(saved.raw_id).then(setRawExtraction, () => lastRawExtraction.clear());
    // 마운트 시 한 번만 실행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const input = (variant: "zone" | "button") => (
    <DocumentInput
      variant={variant}
      accept={["docx", "xlsx", "pptx", "pdf"]}
      multiple={false}
      maxFiles={1}
      chunkSize={uploadChunkFiles}
      disabled={Boolean(busy)}
      label={rawExtraction ? "다른 문서" : "문서 추가"}
      onReady={extract}
      onNotice={setNotice}
      description="DOCX, XLSX, PPTX, PDF · 한 번에 한 문서. 보관함에 저장한 뒤 PDF 미리보기와 HTML 원문으로 바꿉니다."
    />
  );

  return (
    <ModulePage
      module="raw"
      header={
        <PageHeader
          eyebrow="원문 데이터 추출"
          title={rawExtraction?.filename || "문서를 선택하세요"}
          description="Office·PDF 문서를 PDF 미리보기와 HTML 원문(표·이미지·수식 포함)으로 바꿉니다."
          steps={[
            { label: "문서", active: !rawExtraction, done: Boolean(rawExtraction) },
            { label: "추출", active: Boolean(busy), done: rawExtraction?.status === "completed" },
            { label: "확인", active: Boolean(htmlUrl), done: false }
          ]}
          collapseActions
          actions={input("button")}
        />
      }
      alerts={
        busy || notice ? (
          <>
            {busy && <InlineAlert busy>{busy}</InlineAlert>}
            {notice && (
              <InlineAlert tone={notice.tone} onDismiss={() => setNotice(null)}>
                {notice.text}
              </InlineAlert>
            )}
          </>
        ) : null
      }
    >
      <SplitPane
        leftLabel="문서"
        rightLabel="추출 결과"
        left={
          <div className="ui-document-main">
            {pdfUrl ? (
              <div className="ui-viewer">
                <div className="pane-header ui-viewer-header">
                  <div className="ui-viewer-title">
                    <p className="eyebrow">PDF 미리보기</p>
                    <h2>{rawExtraction?.filename}</h2>
                  </div>
                </div>
                <iframe className="raw-frame" src={pdfUrl} title="PDF 미리보기" />
              </div>
            ) : (
              input("zone")
            )}
          </div>
        }
        right={
          <div className="ui-side-stack">
            <Card
              className="raw-result-card"
              eyebrow="결과"
              title="HTML 미리보기"
              actions={
                htmlUrl ? (
                  <a className="ui-button secondary compact" href={htmlUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} />
                    새 창
                  </a>
                ) : undefined
              }
            >
              <div className="ui-option-row" role="group" aria-label="추출 옵션">
                <label className="ui-inline-check">
                  <input
                    type="checkbox"
                    checked={options.includeImages}
                    onChange={(event) => setOptions({ ...options, includeImages: event.target.checked })}
                  />
                  이미지 추출
                </label>
                <label className="ui-inline-check">
                  <input
                    type="checkbox"
                    checked={options.includeFormulas}
                    onChange={(event) => setOptions({ ...options, includeFormulas: event.target.checked })}
                  />
                  수식 추출
                </label>
              </div>
              {rawExtraction && (
                <div className="ui-result-summary">
                  <div className="ui-result-summary-main">
                    <StatusBadge status={rawExtraction.status} />
                    <strong>{rawExtraction.source_format.toUpperCase()}</strong>
                    <span>{formatDate(rawExtraction.created_at)}</span>
                  </div>
                  {rawExtraction.warnings.length > 0 && <small>{rawExtraction.warnings.join(", ")}</small>}
                </div>
              )}
              {htmlUrl ? (
                <iframe className="raw-frame html-frame" src={htmlUrl} title="HTML 추출 미리보기" />
              ) : (
                <EmptyState compact icon={<FileText size={28} />} title="아직 추출 결과가 없습니다.">
                  문서를 추가하면 추출한 HTML이 여기에 표시됩니다.
                </EmptyState>
              )}
            </Card>
            <Card className="raw-history-card" eyebrow="기록" title="원문 추출 기록" headingLevel={3}>
              {recentQuery.data?.length ? (
                <ul className="ui-history-list">
                  {recentQuery.data.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={item.id === rawExtraction?.id ? "ui-history-row active" : "ui-history-row"}
                        onClick={() => void run("원문 추출 결과 불러오는 중", () => getRawExtraction(item.id))}
                      >
                        <span>
                          <strong>{item.filename}</strong>
                          <small>
                            {item.source_format.toUpperCase()} · {formatDate(item.created_at)}
                          </small>
                        </span>
                        <StatusBadge status={item.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact>아직 원문 추출 기록이 없습니다.</EmptyState>
              )}
            </Card>
          </div>
        }
      />
    </ModulePage>
  );
}
