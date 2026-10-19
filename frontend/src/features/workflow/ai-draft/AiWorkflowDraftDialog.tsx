import { Loader2, Sparkles, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { WORKFLOW_AI_DRAFT_ACCEPT, WORKFLOW_AI_DRAFT_MAX_IMAGES } from "../model/files";

/** 샘플 이미지로 워크플로우 초안을 만드는 다이얼로그. */
export function AiWorkflowDraftDialog(props: {
  files: File[];
  persistSamples: boolean;
  includeChecklist: boolean;
  isGenerating: boolean;
  onFilesChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPersistSamplesChange: (value: boolean) => void;
  onIncludeChecklistChange: (value: boolean) => void;
  onGenerate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel ai-workflow-draft-dialog" role="dialog" aria-modal="true" aria-label="AI 워크플로우 생성">
        <div className="modal-header">
          <div>
            <p className="eyebrow">AI Workflow Draft</p>
            <h2>샘플로 워크플로우 생성</h2>
          </div>
          <button type="button" className="icon-only" onClick={props.onClose} aria-label="닫기" disabled={props.isGenerating}>
            <X size={18} />
          </button>
        </div>
        <label className="ai-workflow-dropzone">
          <Sparkles size={22} />
          <strong>{props.files.length ? `${props.files.length.toLocaleString()}개 이미지 선택됨` : "샘플 이미지 선택"}</strong>
          <span>PNG/JPG 최대 {WORKFLOW_AI_DRAFT_MAX_IMAGES}장</span>
          <input type="file" multiple accept={WORKFLOW_AI_DRAFT_ACCEPT} onChange={props.onFilesChange} disabled={props.isGenerating} />
        </label>
        {props.files.length > 0 && (
          <div className="ai-workflow-file-list">
            {props.files.map((file) => (
              <span key={`${file.name}-${file.lastModified}`}>{file.name}</span>
            ))}
          </div>
        )}
        <div className="ai-workflow-options">
          <label className="ai-workflow-option">
            <input
              type="checkbox"
              checked={props.includeChecklist}
              onChange={(event) => props.onIncludeChecklistChange(event.target.checked)}
              disabled={props.isGenerating}
            />
            <span>필수 항목 확인 초안 포함</span>
          </label>
          <label className="ai-workflow-option">
            <input
              type="checkbox"
              checked={props.persistSamples}
              onChange={(event) => props.onPersistSamplesChange(event.target.checked)}
              disabled={props.isGenerating}
            />
            <span>샘플 문서를 보관함에 저장</span>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={props.onClose} disabled={props.isGenerating}>
            취소
          </button>
          <button type="button" className="primary" onClick={props.onGenerate} disabled={props.isGenerating || !props.files.length}>
            {props.isGenerating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            생성
          </button>
        </div>
      </section>
    </div>
  );
}
