// 분류기 초안 기본값·정규화·저장 바디. (순수 함수, 테스트 대상)
import type { Schemas } from "../../api/client";
import { formatDate } from "../../lib/format";
import type { ClassCandidateDraft, ClassifierDraft, DocumentClassifier } from "./types";

export function defaultClassifier(): ClassifierDraft {
  return {
    id: "",
    name: "새 문서 분류기",
    description: "업로드 문서를 사용자가 정의한 후보 class 중 하나 또는 unknown으로 분류합니다.",
    allow_unknown: true,
    archived: false,
    classes: [
      { class_name: "계약서", description: "계약 조건, 당사자, 서명 또는 날인이 포함된 문서", signals: ["계약", "서명", "날인"] },
      { class_name: "신청서", description: "신청자 정보와 동의 체크 항목이 포함된 신청서", signals: ["신청", "동의", "작성일"] }
    ],
    created_at: "",
    updated_at: ""
  };
}

export function normalizeClassifier(config: DocumentClassifier): ClassifierDraft {
  const classes = config.classes.map((item) => ({ ...item, signals: item.signals ?? [] }));
  return { ...config, classes: classes.length ? classes : defaultClassifier().classes };
}

export function signalText(item: ClassCandidateDraft): string {
  return item.signals_text ?? item.signals.join(", ");
}

export function signalsForPayload(item: ClassCandidateDraft): string[] {
  if (item.signals_text === undefined) return item.signals.map((signal) => signal.trim()).filter(Boolean);
  return item.signals_text
    .split(/\n+/)
    .map((signal) => signal.trim())
    .filter(Boolean);
}

export function toClassifierPayload(config: ClassifierDraft): Schemas["DocumentClassifierCreate"] {
  const classes = config.classes
    .map((item) => ({
      class_name: item.class_name.trim(),
      description: item.description.trim(),
      signals: signalsForPayload(item)
    }))
    .filter((item) => item.class_name && item.description);
  if (!config.name.trim()) throw new Error("분류 설정 이름을 입력하세요.");
  if (!classes.length) throw new Error("문서 클래스를 최소 1개 이상 입력하세요.");
  return {
    name: config.name.trim(),
    description: config.description?.trim() || null,
    allow_unknown: true,
    classes
  };
}

export function summarizeClassifier(config: DocumentClassifier): string {
  return `${config.classes.length}개 클래스 · ${formatDate(config.updated_at)}`;
}
