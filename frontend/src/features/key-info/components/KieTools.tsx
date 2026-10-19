// KIE 보조 화면: 아카이브 검색(Dialog), 배치 기록(Drawer), Schema 목록 Drawer의 추가 도구.
import { FileDown, FileUp, Search } from "lucide-react";
import type { ArchiveSearchResult, SystemStatus } from "../../../api/types";
import {
  Button,
  Dialog,
  Drawer,
  EmptyState,
  ExportMenu,
  ProgressBar,
  StatusBadge
} from "../../../components/ui";
import { documentLabel, formatDate, formatDateTime } from "../../../lib/format";
import { statusLabel } from "../../../lib/status";
import type { SchemaDraft } from "../hooks/useSchemaDraft";
import { batchJobExportOptions } from "../model/review";
import type { Batch, SavedSchema, UploadedDocument } from "../types";

export function ArchiveDialog(props: {
  open: boolean;
  query: string;
  status: string;
  results: ArchiveSearchResult[];
  onQuery: (value: string) => void;
  onStatus: (value: string) => void;
  onOpen: (item: ArchiveSearchResult) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={props.open} eyebrow="저장된 결과" title="아카이브 검색" onClose={props.onClose}>
      <div className="ui-toolbar-row">
        <label className="ui-search-field">
          <Search size={15} aria-hidden />
          <input
            aria-label="아카이브 검색어"
            value={props.query}
            placeholder="문서, schema, 추출값 검색"
            onChange={(event) => props.onQuery(event.target.value)}
          />
        </label>
        <select aria-label="상태" value={props.status} onChange={(event) => props.onStatus(event.target.value)}>
          <option value="">전체 상태</option>
          <option value="completed">완료</option>
          <option value="needs_review">검토 필요</option>
          <option value="failed">실패</option>
        </select>
      </div>
      {props.results.length ? (
        <ul className="ui-history-list">
          {props.results.slice(0, 12).map((item) => (
            <li key={`${item.document_id}_${item.job_id ?? "doc"}`}>
              <button type="button" className="ui-history-row" onClick={() => props.onOpen(item)}>
                <span>
                  <strong>{item.filename}</strong>
                  <small>
                    {item.document_type || item.schema_name || "문서"} · {formatDate(item.created_at)}
                  </small>
                </span>
                <StatusBadge status={item.status} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact>일치하는 결과가 없습니다.</EmptyState>
      )}
    </Dialog>
  );
}

/** 최근 배치 추출 기록. 배치를 누르면 첫 항목(또는 고른 항목)을 연다. */
export function BatchHistoryDrawer(props: {
  open: boolean;
  batches: Batch[];
  activeBatchId: string | null;
  onOpen: (batch: Batch) => void;
  onClose: () => void;
}) {
  return (
    <Drawer open={props.open} eyebrow="핵심 정보 추출" title="배치 기록" width="min(520px, 100vw)" onClose={props.onClose}>
      {props.batches.length ? (
        <ul className="ui-history-list">
          {props.batches.map((batch) => {
            const label = batch.items[0] ? documentLabel(batch.items[0].filename, batch.items[0].page_number) : "배치";
            return (
              <li key={batch.id} className={batch.id === props.activeBatchId ? "ui-history-card active" : "ui-history-card"}>
                <button type="button" className="ui-history-row" onClick={() => props.onOpen(batch)}>
                  <span>
                    <strong>
                      {label}
                      {batch.total_count > 1 ? ` 외 ${(batch.total_count - 1).toLocaleString()}개` : ""}
                    </strong>
                    <small>
                      {formatDateTime(batch.created_at)} · 완료 {batch.completed_count} · 실패 {batch.failed_count} · 전체{" "}
                      {batch.total_count}
                    </small>
                  </span>
                  <StatusBadge status={batch.status} />
                </button>
                <div className="ui-history-card-foot">
                  <ProgressBar value={batch.progress} label={`${statusLabel(batch.status)} 진행률`} showLabel />
                  <ExportMenu compact fixed align="right" options={batchJobExportOptions(batch.id)} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact>아직 배치 추출 기록이 없습니다.</EmptyState>
      )}
    </Drawer>
  );
}

/** Schema 목록 Drawer 아래 도구: 템플릿, JSON 가져오기·내보내기, 문서 정보, JSON 미리보기. */
export function SchemaListExtras(props: {
  schema: SchemaDraft;
  document: UploadedDocument | null;
  systemStatus: SystemStatus | null;
  onImport: () => void;
  onSaveTemplate: () => void;
  onLoadTemplate: (template: SavedSchema) => void;
}) {
  const { schema } = props;
  return (
    <div className="ui-drawer-sections">
      {props.systemStatus?.is_mock && (
        <p className="ui-field-note">Mock 모드입니다. AI 추천과 추출은 고정된 데모 데이터를 사용합니다.</p>
      )}
      <section>
        <header className="ui-section-head">
          <strong>템플릿</strong>
          <Button size="sm" variant="ghost" disabled={!schema.schema} onClick={props.onSaveTemplate}>
            현재 schema를 템플릿으로
          </Button>
        </header>
        {schema.templates.length ? (
          <ul className="ui-history-list">
            {schema.templates.slice(0, 6).map((template) => (
              <li key={template.id}>
                <button type="button" className="ui-history-row" onClick={() => props.onLoadTemplate(template)}>
                  <span>
                    <strong>{template.display_name || template.name}</strong>
                    <small>
                      {template.template_category || "일반"} · {template.fields.length}개 필드
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ui-field-note">Schema를 템플릿으로 저장하면 여기에서 다시 쓸 수 있습니다.</p>
        )}
      </section>
      {props.document && (
        <section>
          <header className="ui-section-head">
            <strong>문서 정보</strong>
          </header>
          <p className="ui-field-note">
            {props.document.document_type || "문서 유형 미확인"} · {props.document.language || "언어 미확인"} ·{" "}
            {props.document.page_count}페이지
            {props.document.recommendation_reasoning ? ` · ${props.document.recommendation_reasoning}` : ""}
          </p>
        </section>
      )}
      <section>
        <header className="ui-section-head">
          <strong>Schema JSON</strong>
          <a className="ui-button ghost compact" href={schema.downloadUrl} download={`${schema.schemaName || "schema"}.json`}>
            <FileDown size={14} />
            내려받기
          </a>
        </header>
        <details className="ui-advanced">
          <summary>JSON 붙여넣어 가져오기</summary>
          <textarea
            aria-label="Schema JSON"
            value={schema.jsonInput}
            onChange={(event) => schema.setJsonInput(event.target.value)}
            placeholder="Schema JSON을 붙여넣으세요"
          />
          <Button size="sm" icon={<FileUp size={14} />} onClick={props.onImport}>
            가져오기
          </Button>
        </details>
        <details className="ui-advanced">
          <summary>현재 schema JSON 보기</summary>
          <pre className="ui-code-block">{schema.preview}</pre>
        </details>
      </section>
    </div>
  );
}
