import { RefreshCcw } from "lucide-react";
import { Card, EmptyState, IconButton, StatusBadge } from "../../../components/ui";
import { formatDateTime } from "../../../lib/format";
import type { RotationBatch } from "../types";

/** 최근 회전 보정 실행 목록. 누르면 그 배치를 연다. */
export function RotationHistory(props: {
  batches: RotationBatch[];
  activeBatchId: string | null;
  onOpen: (batchId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <Card
      className="rotation-history-card"
      eyebrow="기록"
      title="최근 실행"
      headingLevel={3}
      actions={
        <IconButton label="새로고침" size="sm" variant="ghost" onClick={props.onRefresh}>
          <RefreshCcw size={14} />
        </IconButton>
      }
    >
      {props.batches.length ? (
        <ul className="ui-history-list">
          {props.batches.map((batch) => (
            <li key={batch.id}>
              <button
                type="button"
                className={batch.id === props.activeBatchId ? "ui-history-row active" : "ui-history-row"}
                aria-current={batch.id === props.activeBatchId ? "true" : undefined}
                onClick={() => props.onOpen(batch.id)}
              >
                <span>
                  <strong>{formatDateTime(batch.created_at)}</strong>
                  <small>
                    {batch.total_count.toLocaleString()}개 항목
                    {batch.corrected_page_count ? ` · ${batch.corrected_page_count.toLocaleString()}페이지 보정` : ""}
                  </small>
                </span>
                <StatusBadge status={batch.status || "queued"} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact>아직 실행한 회전 보정이 없습니다.</EmptyState>
      )}
    </Card>
  );
}
