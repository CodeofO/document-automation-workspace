import { Plus, ScanLine, Trash2 } from "lucide-react";
import { useState } from "react";
import { RegionPicker, type PickerPage } from "../../../components/document/RegionPicker";
import { Button, Dialog, EmptyState, IconButton } from "../../../components/ui";
import { createRegionId, formatRegionNumber } from "../model/schema";
import type { SchemaRegion } from "../types";

/** 공유 영역 목록(여러 필드가 같은 영역을 쓸 수 있다). 새로 그리기·다시 그리기·삭제. */
export function RegionManagerDialog(props: {
  pages: PickerPage[];
  regions: SchemaRegion[];
  activePage: number;
  onSaveRegion: (region: SchemaRegion) => void;
  onRemoveRegion: (regionId: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<SchemaRegion | null>(null);
  const canDraw = props.pages.length > 0;

  function createRegion() {
    const page = props.pages[Math.min(props.activePage, props.pages.length - 1)]?.page ?? 1;
    setEditing({
      id: createRegionId(props.regions),
      name: `영역 ${props.regions.length + 1}`,
      page,
      x: 0.1,
      y: 0.1,
      width: 0.25,
      height: 0.12
    });
  }

  return (
    <Dialog open eyebrow="추출 영역" title="공유 영역" closeLabel="영역 닫기" onClose={props.onClose}>
      <div className="ui-hint-row">
        <span>하나의 영역을 여러 필드에 쓸 수 있습니다. 필드 표의 영역 열에서 고르세요.</span>
        <Button size="sm" variant="primary" icon={<Plus size={14} />} disabled={!canDraw} onClick={createRegion}>
          영역 추가
        </Button>
      </div>
      {props.regions.length ? (
        <ul className="ui-history-list">
          {props.regions.map((region) => (
            <li key={region.id} className="ui-history-row static">
              <span>
                <strong>{region.name}</strong>
                <small>
                  p.{region.page} · x {formatRegionNumber(region.x)} · y {formatRegionNumber(region.y)} · w{" "}
                  {formatRegionNumber(region.width)} · h {formatRegionNumber(region.height)}
                </small>
              </span>
              <span className="ui-row-actions">
                <IconButton label={`${region.name} 다시 그리기`} size="sm" variant="ghost" disabled={!canDraw} onClick={() => setEditing(region)}>
                  <ScanLine size={15} />
                </IconButton>
                <IconButton label={`${region.name} 삭제`} size="sm" variant="danger-ghost" onClick={() => props.onRemoveRegion(region.id)}>
                  <Trash2 size={15} />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact>아직 저장된 영역이 없습니다.</EmptyState>
      )}
      {editing && canDraw && (
        <RegionPicker
          pages={props.pages}
          region={editing}
          onSave={(region) => {
            props.onSaveRegion(region);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </Dialog>
  );
}
