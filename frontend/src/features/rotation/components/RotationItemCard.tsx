import { InlineAlert, StatusBadge } from "../../../components/ui";
import { documentLabel } from "../../../lib/format";
import { rotationItemStatusLabel } from "../model";
import type { ManualRotationDegrees, ManualRotationState, RotationBatchItem } from "../types";
import { RotationPageGrid } from "./RotationPageGrid";

/** 배치 항목 하나(문서 또는 페이지): 제목, 상태, 오류, 페이지 그리드. */
export function RotationItemCard(props: {
  item: RotationBatchItem;
  manualRotations: ManualRotationState;
  rotatingKey: string | null;
  onRotate: (documentId: string, pageNumber: number, degrees: ManualRotationDegrees) => void;
}) {
  const { item } = props;
  return (
    <article className={`rotation-item-card ${item.status}`}>
      <div className="rotation-item-head">
        <div>
          <strong>{documentLabel(item.filename, item.page_number)}</strong>
          <small>
            {item.pages.length ? `${item.pages.length.toLocaleString()}페이지` : ""}
            {item.corrected_page_count ? ` · ${item.corrected_page_count.toLocaleString()}페이지 보정됨` : ""}
          </small>
        </div>
        <StatusBadge status={item.status} label={rotationItemStatusLabel(item.status)} />
      </div>
      {item.error_message && (
        <InlineAlert tone="danger">{item.error_message}</InlineAlert>
      )}
      {item.pages.length > 0 && (
        <RotationPageGrid
          documentId={item.document_id}
          pages={item.pages}
          manualRotations={props.manualRotations}
          rotatingKey={props.rotatingKey}
          onRotate={(pageNumber, degrees) => props.onRotate(item.document_id, pageNumber, degrees)}
        />
      )}
    </article>
  );
}
