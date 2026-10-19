// 회전 보정 뷰 모델. 서버 응답(Schemas["Rotation*Read"])을 화면이 쓰기 좋게 좁힌 모양이다.
import type { Schemas } from "../../api/client";

export type RotationDegrees = 0 | 90 | 180 | 270;
export type ManualRotationDegrees = 90 | 180 | 270;

/** 페이지 하나의 감지·보정 결과. 워크플로우 결과 창도 같은 타입을 쓴다. */
export type RotationPageResult = {
  page_number: number;
  status: "upright" | "corrected" | "low_confidence" | "skipped";
  applied: boolean;
  correction: RotationDegrees;
  detected_rotation: RotationDegrees;
  confidence: number | null;
  reason: string;
  rotation_before?: number | null;
  rotation_after?: number | null;
};

/**
 * 배치 항목(문서 하나). 처리 단위가 페이지로 바뀌면 page_number가 붙는다(없거나 null이면 문서 전체).
 */
export type RotationBatchItem = Omit<Schemas["RotationBatchItemRead"], "job_id" | "pages" | "error_message"> & {
  job_id: string | null;
  error_message: string | null;
  page_number?: number | null;
  pages: RotationPageResult[];
};

export type RotationBatch = Omit<Schemas["RotationBatchRead"], "items"> & { items: RotationBatchItem[] };

export type RotationItemFilter = "all" | "corrected" | "review" | "failed";

/** 수동 회전 상태. 키는 `${documentId}:${pageNumber}`. version은 썸네일 캐시 무효화용. */
export type ManualRotationState = Record<string, { rotation: number; version: number }>;
