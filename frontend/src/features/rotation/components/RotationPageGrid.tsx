import { Loader2, RotateCcw, RotateCw } from "lucide-react";
import { documentPageImageUrl, documentPageThumbnailUrl } from "../../../api/client";
import { Button, StatusBadge } from "../../../components/ui";
import { formatConfidence } from "../../../lib/format";
import { rotationCacheBuster, rotationPageBadge, rotationPageKey } from "../model";
import type { ManualRotationDegrees, ManualRotationState, RotationPageResult } from "../types";

/** 페이지 썸네일과 회전 배지. 회전 보정 화면과 워크플로우 결과 창이 같이 쓴다. */
export function RotationPageGrid(props: {
  documentId: string;
  pages: RotationPageResult[];
  thumbnailWidth?: number;
  manualRotations?: ManualRotationState;
  rotatingKey?: string | null;
  onRotate?: (pageNumber: number, degrees: ManualRotationDegrees) => void;
}) {
  const width = props.thumbnailWidth ?? 180;
  const pages = [...props.pages].sort((a, b) => a.page_number - b.page_number);
  return (
    <div className="rotation-page-grid">
      {pages.map((page) => {
        const key = rotationPageKey(props.documentId, page.page_number);
        const manual = props.manualRotations?.[key];
        const badge = rotationPageBadge(page);
        const cacheBuster = rotationCacheBuster(page, manual);
        const rotating = props.rotatingKey === key;
        return (
          <div key={page.page_number} className={`rotation-page-card ${badge.tone} ${manual ? "manual" : ""}`}>
            <a
              className="rotation-page-thumb"
              href={documentPageImageUrl(props.documentId, page.page_number, cacheBuster)}
              target="_blank"
              rel="noreferrer"
              title="원본 크기로 보기"
            >
              <img
                src={documentPageThumbnailUrl(props.documentId, page.page_number, width, cacheBuster)}
                alt={`${page.page_number}페이지`}
                loading="lazy"
              />
              {rotating && (
                <span className="rotation-page-busy">
                  <Loader2 size={18} className="spin" />
                </span>
              )}
            </a>
            <div className="rotation-page-meta">
              <strong>{page.page_number}p</strong>
              <StatusBadge status={page.status} label={badge.label} tone={badge.statusTone} />
            </div>
            <small className="rotation-page-detail">{badge.detail}</small>
            <small className="rotation-page-confidence">신뢰도 {formatConfidence(page.confidence)}</small>
            {manual && <small className="rotation-page-manual">수동 회전 적용 · 현재 {manual.rotation}°</small>}
            {page.reason && (
              <details className="rotation-page-reason">
                <summary>판단 근거</summary>
                <p>{page.reason}</p>
              </details>
            )}
            {props.onRotate && (
              <div className="rotation-page-actions">
                <Button
                  size="sm"
                  icon={<RotateCcw size={13} />}
                  disabled={rotating}
                  title="반시계 방향 90° 회전"
                  aria-label={`${page.page_number}페이지 반시계 방향 90° 회전`}
                  onClick={() => props.onRotate?.(page.page_number, 270)}
                >
                  90°
                </Button>
                <Button
                  size="sm"
                  icon={<RotateCw size={13} />}
                  disabled={rotating}
                  title="시계 방향 90° 회전"
                  aria-label={`${page.page_number}페이지 시계 방향 90° 회전`}
                  onClick={() => props.onRotate?.(page.page_number, 90)}
                >
                  90°
                </Button>
                <Button
                  size="sm"
                  disabled={rotating}
                  title="180° 회전"
                  aria-label={`${page.page_number}페이지 180° 회전`}
                  onClick={() => props.onRotate?.(page.page_number, 180)}
                >
                  180°
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
