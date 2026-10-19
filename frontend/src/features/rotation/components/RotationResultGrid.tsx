import { useMemo, useState } from "react";
import { Button, EmptyState, FilterChips } from "../../../components/ui";
import { ROTATION_ITEM_FILTERS, ROTATION_ITEM_PAGE_SIZE, filterRotationItems } from "../model";
import type { ManualRotationDegrees, ManualRotationState, RotationBatch, RotationItemFilter } from "../types";
import { RotationItemCard } from "./RotationItemCard";

/**
 * 결과 그리드(왼쪽 Main): 필터 칩 + 항목 카드(페이지 썸네일·배지·수동 회전), 30개씩 더 보기.
 * 배치가 바뀌면 부모가 key로 다시 마운트해 필터·페이지를 초기화한다.
 */
export function RotationResultGrid(props: {
  batch: RotationBatch;
  terminal: boolean;
  manualRotations: ManualRotationState;
  rotatingKey: string | null;
  onRotate: (documentId: string, pageNumber: number, degrees: ManualRotationDegrees) => void;
}) {
  const { batch } = props;
  const [filter, setFilter] = useState<RotationItemFilter>("all");
  const [visibleItemCount, setVisibleItemCount] = useState(ROTATION_ITEM_PAGE_SIZE);
  const filteredItems = useMemo(() => filterRotationItems(batch.items, filter), [batch, filter]);
  const counts = useMemo(
    () => Object.fromEntries(ROTATION_ITEM_FILTERS.map((option) => [option.value, filterRotationItems(batch.items, option.value).length])),
    [batch]
  );

  return (
    <div className="rotation-result-grid">
      <div className="rotation-result-toolbar">
        <FilterChips
          label="결과 필터"
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setVisibleItemCount(ROTATION_ITEM_PAGE_SIZE);
          }}
          options={ROTATION_ITEM_FILTERS.map((option) => ({ ...option, count: counts[option.value] }))}
        />
      </div>
      <div className="rotation-item-list">
        {filteredItems.length ? (
          filteredItems
            .slice(0, visibleItemCount)
            .map((item) => (
              <RotationItemCard
                key={item.id}
                item={item}
                manualRotations={props.manualRotations}
                rotatingKey={props.rotatingKey}
                onRotate={props.onRotate}
              />
            ))
        ) : (
          <EmptyState compact>
            {batch.items.length
              ? "조건에 맞는 문서가 없습니다."
              : props.terminal
                ? "표시할 결과가 없습니다."
                : "처리 결과를 기다리는 중입니다."}
          </EmptyState>
        )}
        {filteredItems.length > visibleItemCount && (
          <Button className="rotation-more" onClick={() => setVisibleItemCount((count) => count + ROTATION_ITEM_PAGE_SIZE)}>
            {(filteredItems.length - visibleItemCount).toLocaleString()}개 더 보기
          </Button>
        )}
      </div>
    </div>
  );
}
