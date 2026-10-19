// 검토 화면 뷰어 위 덧그림: 양식의 표 영역(색 상자) + 선택 행 띠(y_center). 좌표는 페이지 비율.
import type { CSSProperties } from "react";
import { regionColorVar } from "../model/regions";
import type { TableRegion } from "../types";

function boxStyle(region: TableRegion, color: string): CSSProperties {
  return {
    "--region-color": color,
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`
  } as CSSProperties;
}

export function TableRegionOverlay(props: {
  regions: { key: string; name: string; order: number; region: TableRegion | null }[];
  activeKey: string | null;
  band: TableRegion | null;
  showRegions: boolean;
}) {
  const active = props.regions.find((item) => item.key === props.activeKey);
  return (
    <div className="table-overlay-layer" aria-hidden>
      {props.showRegions &&
        props.regions.map((item) =>
          item.region ? (
            <div
              key={item.key}
              className={item.key === props.activeKey ? "table-overlay-region active" : "table-overlay-region"}
              style={boxStyle(item.region, regionColorVar(item.order))}
            >
              <span>{item.name}</span>
            </div>
          ) : null
        )}
      {props.band && (
        <div
          className="table-overlay-band"
          data-testid="table-row-band"
          style={boxStyle(props.band, active ? regionColorVar(active.order) : "var(--color-accent)")}
        />
      )}
    </div>
  );
}
