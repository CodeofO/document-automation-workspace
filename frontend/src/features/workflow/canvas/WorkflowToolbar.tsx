// 캔버스 위 툴바: 이름·불러오기·AI 생성·저장 | 실행 문서·실행·예약. 선택 상태 칩은 두지 않는다(Inspector가 맡음).
import { Loader2, Play, Plus, Save, Sparkles } from "lucide-react";
import { UploadPicker } from "../../../components/ui";
import { DocumentPickerButton } from "../../library";
import { WORKFLOW_FILE_ACCEPT } from "../model/files";
import { workflowRunCanEnqueue, workflowRunSourceLabel, workflowRunSourceTitle } from "../model/runRules";
import type { WorkflowDefinition, WorkflowRun } from "../types";
import type { WorkflowRunLauncher } from "./useWorkflowRunLauncher";

export function WorkflowToolbar(props: {
  workflowName: string;
  onWorkflowNameChange: (name: string) => void;
  activeWorkflowId: string;
  workflows: WorkflowDefinition[];
  onLoadWorkflow: (workflowId: string) => void;
  onOpenAiDraft: () => void;
  aiGenerating: boolean;
  validationErrors: string[];
  launcher: WorkflowRunLauncher;
  uploadChunkFiles: number;
  isRunningRun: boolean;
  activeRun: WorkflowRun | null;
}) {
  const { launcher, validationErrors, activeRun } = props;
  const busy = launcher.isStartingRun || props.isRunningRun;
  const runButtonTitle = validationErrors.length
    ? `실행할 수 없습니다: ${validationErrors[0]}`
    : props.activeWorkflowId
      ? "현재 워크플로우를 저장한 뒤 실행합니다."
      : "워크플로우를 자동 저장한 뒤 실행합니다.";
  return (
    <div className="workflow-toolbar">
      <div className="wf-toolbar-group wf-toolbar-group-main">
        <input
          className="wf-toolbar-name"
          value={props.workflowName}
          onChange={(event) => props.onWorkflowNameChange(event.target.value)}
          aria-label="워크플로우 이름"
        />
        <select
          className="wf-toolbar-select"
          value={props.activeWorkflowId}
          onChange={(event) => props.onLoadWorkflow(event.target.value)}
          aria-label="워크플로우 불러오기"
        >
          <option value="">새 워크플로우</option>
          {props.workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        </select>
        <button type="button" className="secondary" onClick={props.onOpenAiDraft} disabled={props.aiGenerating || busy}>
          {props.aiGenerating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} AI 생성
        </button>
        <button
          type="button"
          onClick={() => void launcher.saveWorkflow()}
          disabled={launcher.isSaving || validationErrors.length > 0}
          title={validationErrors.length ? `저장할 수 없습니다: ${validationErrors[0]}` : "저장 (⌘/Ctrl+S)"}
        >
          {launcher.isSaving ? <Loader2 size={16} className="spin" /> : <Save size={16} />} 저장
        </button>
      </div>
      <div className="workflow-run-toolbar-actions">
        <UploadPicker
          accept={WORKFLOW_FILE_ACCEPT}
          fixed
          disabled={busy}
          selectedCount={launcher.files.length}
          onSelectFiles={launcher.selectUploadFiles}
        />
        <DocumentPickerButton
          selectedDocuments={launcher.libraryDocuments}
          uploadChunkFiles={props.uploadChunkFiles}
          disabled={busy}
          onSelected={launcher.selectLibraryDocuments}
        />
        <button
          type="button"
          className="primary workflow-run-primary-button"
          onClick={() => void launcher.runWorkflow()}
          disabled={busy || !launcher.selectedDocumentCount}
          title={runButtonTitle}
        >
          {busy ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
          {launcher.isStartingRun ? "시작 중" : props.isRunningRun ? "실행 중" : "실행"}
        </button>
        {activeRun && workflowRunCanEnqueue(activeRun) && (
          <button
            type="button"
            className="secondary workflow-run-reserve-button"
            onClick={() => void launcher.enqueueRun(activeRun.id)}
            disabled={launcher.isStartingRun || launcher.isSaving || validationErrors.length > 0}
            title={
              validationErrors.length
                ? `예약할 수 없습니다: ${validationErrors[0]}`
                : `${workflowRunSourceTitle(activeRun)}를 재사용해 캔버스의 워크플로우를 다음 실행으로 예약합니다.`
            }
          >
            <Plus size={15} /> {workflowRunSourceLabel(activeRun)}로 실행 예약
          </button>
        )}
      </div>
    </div>
  );
}
