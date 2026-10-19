// 정의 카드 헤더의 "AI 추천": 현재 문서 이미지로 체크리스트 초안을 만든다.
import { Sparkles } from "lucide-react";
import { api, jsonBody } from "../../api/client";
import { Button } from "../../components/ui";
import type { ModuleActionContext } from "../module-batch";
import { checklistFromRecommendation } from "./model";
import type { ChecklistRecommendation, RequiredFieldChecklist } from "./types";

export function ChecklistRecommendButton(context: ModuleActionContext<RequiredFieldChecklist>) {
  const { document, busy, runTask, replaceDraft, setShowRegions, notify } = context;
  const recommend = () => {
    if (!document) {
      notify("AI 추천을 사용하려면 먼저 문서를 업로드하세요.", "danger");
      return;
    }
    void runTask("AI 체크리스트 추천 중", async () => {
      const recommendation = await api<ChecklistRecommendation>(
        "/api/required-field-checklists/recommendations",
        jsonBody("POST", { document_id: document.document_id })
      );
      replaceDraft(checklistFromRecommendation(recommendation));
      setShowRegions(Boolean(recommendation.regions?.length));
      notify(recommendation.reasoning || "AI 추천 체크리스트를 적용했습니다. 검토 후 저장하세요.", "info");
    });
  };
  return (
    <Button
      variant="primary"
      size="sm"
      icon={<Sparkles size={15} />}
      disabled={busy || !document}
      title={document ? "현재 문서 이미지로 필수 항목 체크리스트를 추천합니다." : "문서를 먼저 업로드해야 AI 추천을 사용할 수 있습니다."}
      onClick={recommend}
    >
      AI 추천
    </Button>
  );
}
