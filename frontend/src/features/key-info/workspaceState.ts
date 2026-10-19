// KIE 작업 상태(마지막 문서·schema·job·배치)를 저장해 다시 들어오면 복원한다. 기존 키를 그대로 쓴다.
import { createStoredValue } from "../../lib/storage";
import type { Step } from "./types";

export type PersistedKieState = {
  step: Step;
  document_id: string | null;
  schema_id: string | null;
  job_id: string | null;
  batch_id: string | null;
  batch_item_id: string | null;
  active_page: number;
};

const asId = (value: unknown) => (typeof value === "string" ? value : null);

export const persistedKieState = createStoredValue<PersistedKieState | null>({
  key: "digitize_workspace_state_v1",
  parse: (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const parsed = raw as Record<string, unknown>;
    // 예전 형식은 화면(mode)까지 저장했다. KIE 화면 상태만 복원한다.
    if (parsed.mode !== undefined && parsed.mode !== "key-info") return null;
    const step = parsed.step === "upload" || parsed.step === "schema" || parsed.step === "review" ? parsed.step : "upload";
    return {
      step,
      document_id: asId(parsed.document_id),
      schema_id: asId(parsed.schema_id),
      job_id: asId(parsed.job_id),
      batch_id: asId(parsed.batch_id),
      batch_item_id: asId(parsed.batch_item_id),
      active_page: typeof parsed.active_page === "number" ? parsed.active_page : 0
    };
  },
  fallback: null
});

export function savePersistedKieState(state: PersistedKieState) {
  persistedKieState.write({ mode: "key-info", ...state } as PersistedKieState);
}
