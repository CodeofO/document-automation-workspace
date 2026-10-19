// 배치(KIE·분류·필수항목) 공통 규칙. 백엔드가 can_* 플래그를 내려주기 전까지 클라이언트에서 판단한다.
import { isActiveStatus } from "../../lib/status";

export type BatchCountsLike = {
  status: string;
  total_count: number;
  uploaded_count?: number;
  queued_count?: number;
  preprocessing_count?: number;
  running_count?: number;
  items: { status: string }[];
};

function countOr(value: number | undefined, items: { status: string }[], status: string) {
  return value ?? items.filter((item) => item.status === status).length;
}

/** 업로드는 끝났는데 대기·멈춘 항목이 남아 있으면 "계속 처리"할 수 있다. */
export function batchCanResume(batch: BatchCountsLike): boolean {
  const uploadedCount = batch.uploaded_count ?? batch.items.length;
  const queuedCount = countOr(batch.queued_count, batch.items, "queued");
  const activeStaleCount =
    countOr(batch.preprocessing_count, batch.items, "preprocessing") + countOr(batch.running_count, batch.items, "running");
  return (
    !["completed", "completed_with_errors", "failed", "canceled"].includes(batch.status) &&
    uploadedCount === batch.total_count &&
    (queuedCount > 0 || activeStaleCount > 0)
  );
}

export function batchCanDiscard(batch: Pick<BatchCountsLike, "status">): boolean {
  return !["completed", "completed_with_errors", "canceled"].includes(batch.status);
}

export function batchIsActive(batch: Pick<BatchCountsLike, "status">): boolean {
  return isActiveStatus(batch.status);
}
