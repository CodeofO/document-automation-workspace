import { CheckSquare, ClipboardList, FileText, Play, RotateCw, Sparkles, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ModuleTarget } from "../../../app/routes";

const RUN_ACTIONS: { target: ModuleTarget; label: string; icon: ReactNode; singleOnly?: boolean }[] = [
  { target: "workflow", label: "워크플로우로 실행", icon: <Play size={15} /> },
  { target: "key-info", label: "핵심 정보 추출", icon: <Sparkles size={15} /> },
  { target: "classifier", label: "문서 분류", icon: <ClipboardList size={15} /> },
  { target: "required-checker", label: "필수 항목 확인", icon: <CheckSquare size={15} /> },
  { target: "table", label: "표 추출", icon: <Table2 size={15} /> },
  { target: "rotation", label: "회전 보정", icon: <RotateCw size={15} /> },
  // 원문 추출은 한 문서씩만 실행한다.
  { target: "raw", label: "원문 추출", icon: <FileText size={15} />, singleOnly: true }
];

/** 보관함 화면 전용: 선택한 문서를 모듈로 보낸다. */
export function LibraryRunActions(props: { selectedCount: number; onRun: (target: ModuleTarget) => void }) {
  return (
    <div className="document-library-actions">
      {RUN_ACTIONS.map((action) => (
        <button
          key={action.target}
          type="button"
          disabled={action.singleOnly ? props.selectedCount !== 1 : !props.selectedCount}
          onClick={() => props.onRun(action.target)}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
}
