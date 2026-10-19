import {
  ChevronLeft,
  ChevronRight,
  FileUp,
  Maximize2,
  PanelLeft,
  RotateCw,
  ScanLine,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { documentPageThumbnailUrl, resolveAssetUrl } from "../../api/client";
import { DOCUMENT_FILE_ACCEPT } from "../../lib/files";
import { IconButton } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

export type ZoomMode = "manual" | "fitWidth" | "fitPage";

/** 화면에 겹쳐 그리는 영역(0~1 상대 좌표). */
export type ViewerRegion = { id: string; name: string; page: number; x: number; y: number; width: number; height: number };

/** 뷰어가 필요로 하는 문서 모양(DocumentRead의 부분집합). image_url이 있으면 뷰어가 직접 그린다. */
export type ViewerDocument = {
  document_id: string;
  filename: string;
  page_count: number;
  status?: string;
  pages: { id: string; page: number; image_url?: string | null }[];
};

/**
 * 공용 문서 뷰어(spec B-4 Main): 페이지 이동·줌·맞춤·회전·영역 표시·썸네일.
 * 줌/회전은 props로 제어하거나(KIE) 생략하면 내부 상태로 동작한다(분류·필수항목).
 * 교체·비우기는 콜백을 줄 때만 보인다.
 */
export function DocumentViewer(props: {
  document: ViewerDocument;
  activePage: number;
  onPage: (page: number) => void;
  /** 생략하면 pages[activePage].image_url을 쓴다. */
  activeImageUrl?: string | null;
  regions?: ViewerRegion[];
  showRegions?: boolean;
  onShowRegions?: (show: boolean) => void;
  hideThumbnailRail?: boolean;
  zoom?: number;
  zoomMode?: ZoomMode;
  rotation?: number;
  onZoom?: (zoom: number) => void;
  onZoomMode?: (mode: ZoomMode) => void;
  onRotation?: (rotation: number) => void;
  onReplaceFile?: (file: File) => void;
  onClear?: () => void;
  eyebrow?: ReactNode;
  /** 제목(기본: 파일명). */
  title?: ReactNode;
  /** 툴바 앞쪽에 붙일 내용(예: 결과 라벨) */
  toolbarExtra?: ReactNode;
  /** 페이지 이미지 위에 덧그릴 내용(페이지 비율 좌표, 예: 표 영역·선택 행 띠). 회전·줌을 따라간다. */
  overlay?: ReactNode;
}) {
  const [localZoom, setLocalZoom] = useState(1);
  const [localZoomMode, setLocalZoomMode] = useState<ZoomMode>("fitWidth");
  const [localRotation, setLocalRotation] = useState(0);
  const zoom = props.zoom ?? localZoom;
  const zoomMode = props.zoomMode ?? localZoomMode;
  const rotation = props.rotation ?? localRotation;
  const setZoom = props.onZoom ?? setLocalZoom;
  const setZoomMode = props.onZoomMode ?? setLocalZoomMode;
  const setRotation = props.onRotation ?? setLocalRotation;
  const regions = props.regions ?? [];
  const pageCount = Math.max(props.document.page_count, props.document.pages.length, 1);
  const activePage = Math.min(Math.max(0, props.activePage), pageCount - 1);
  const page = props.document.pages[activePage];
  const activePageNumber = page?.page ?? activePage + 1;
  const imageUrl =
    props.activeImageUrl !== undefined ? props.activeImageUrl : page?.image_url ? resolveAssetUrl(page.image_url) : null;
  const imageClass = `document-image ${zoomMode}`;
  const transforms = [
    rotation ? `rotate(${rotation}deg)` : "",
    zoomMode === "manual" && zoom !== 1 ? `scale(${zoom})` : ""
  ].filter(Boolean);
  const imageStyle = transforms.length ? { transform: transforms.join(" ") } : undefined;
  const preparing = props.document.status && props.document.status !== "ready";

  return (
    <div className="ui-viewer">
      <div className="pane-header ui-viewer-header">
        <div className="ui-viewer-title">
          <p className="eyebrow">{props.eyebrow ?? "문서"}</p>
          <h2 title={props.document.filename}>{props.title ?? props.document.filename}</h2>
        </div>
        <div className="ui-viewer-toolbar">
          {props.toolbarExtra}
          {preparing && <StatusBadge status={props.document.status} subject="document" />}
          <div className="ui-viewer-pager">
            <IconButton label="이전 페이지" size="sm" variant="ghost" onClick={() => props.onPage(Math.max(0, activePage - 1))}>
              <ChevronLeft size={16} />
            </IconButton>
            <span className="page-count">
              {activePage + 1} / {pageCount}
            </span>
            <IconButton
              label="다음 페이지"
              size="sm"
              variant="ghost"
              onClick={() => props.onPage(Math.min(pageCount - 1, activePage + 1))}
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>
          <span className="ui-toolbar-divider" aria-hidden />
          <IconButton
            label="폭 맞춤"
            size="sm"
            variant="ghost"
            className={zoomMode === "fitWidth" ? "active-tool" : ""}
            onClick={() => setZoomMode("fitWidth")}
          >
            <PanelLeft size={16} />
          </IconButton>
          <IconButton
            label="페이지 맞춤"
            size="sm"
            variant="ghost"
            className={zoomMode === "fitPage" ? "active-tool" : ""}
            onClick={() => setZoomMode("fitPage")}
          >
            <Maximize2 size={16} />
          </IconButton>
          <IconButton
            label="축소"
            size="sm"
            variant="ghost"
            onClick={() => {
              setZoomMode("manual");
              setZoom(Math.max(0.5, zoom - 0.1));
            }}
          >
            <ZoomOut size={16} />
          </IconButton>
          <IconButton
            label="확대"
            size="sm"
            variant="ghost"
            onClick={() => {
              setZoomMode("manual");
              setZoom(Math.min(2, zoom + 0.1));
            }}
          >
            <ZoomIn size={16} />
          </IconButton>
          <IconButton label="회전" size="sm" variant="ghost" onClick={() => setRotation((rotation + 90) % 360)}>
            <RotateCw size={16} />
          </IconButton>
          {props.onShowRegions && (
            <IconButton
              label={regions.length ? (props.showRegions ? "영역 숨기기" : "영역 표시") : "저장된 영역이 없습니다"}
              size="sm"
              variant="ghost"
              className={props.showRegions ? "active-tool" : ""}
              disabled={!regions.length}
              onClick={() => props.onShowRegions?.(!props.showRegions)}
            >
              <ScanLine size={16} />
            </IconButton>
          )}
          {props.onReplaceFile && (
            <label className="toolbar-upload ui-button ghost compact" title="문서 교체">
              <FileUp size={16} />
              <span>교체</span>
              <input
                type="file"
                accept={DOCUMENT_FILE_ACCEPT}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) props.onReplaceFile?.(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          )}
          {props.onClear && (
            <IconButton label="문서 닫기" size="sm" variant="ghost" onClick={props.onClear}>
              <X size={16} />
            </IconButton>
          )}
        </div>
      </div>
      <div className={props.hideThumbnailRail || pageCount < 2 ? "viewer-body no-thumbnail-rail" : "viewer-body"}>
        {!props.hideThumbnailRail && pageCount > 1 && (
          <div className="thumbnail-rail" aria-label="페이지 썸네일">
            {props.document.pages.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={index === activePage ? "active-thumb" : ""}
                title={`${item.page}페이지`}
                aria-current={index === activePage ? "page" : undefined}
                onClick={() => props.onPage(index)}
              >
                <img
                  src={documentPageThumbnailUrl(props.document.document_id, item.page, 96)}
                  alt={`${item.page}페이지`}
                  loading="lazy"
                  decoding="async"
                />
                <span>{item.page}</span>
              </button>
            ))}
          </div>
        )}
        <div className="image-stage">
          {imageUrl ? (
            <div className={`document-image-wrap ${zoomMode}`} style={imageStyle}>
              <img className={imageClass} src={imageUrl} alt={`${activePage + 1}페이지`} />
              {props.showRegions && <RegionOverlay regions={regions} page={activePageNumber} />}
              {props.overlay}
            </div>
          ) : (
            <div className="ui-viewer-placeholder">
              {preparing ? "문서를 변환하는 중입니다. 준비되면 페이지가 표시됩니다." : "표시할 페이지가 없습니다."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 페이지 위에 schema 영역 상자를 겹쳐 그린다. */
export function RegionOverlay({ regions, page }: { regions: ViewerRegion[]; page: number }) {
  const visibleRegions = regions.filter((region) => region.page === page);
  if (!visibleRegions.length) return null;
  return (
    <div className="document-region-layer" aria-label="Schema 영역">
      {visibleRegions.map((region) => (
        <div
          className="document-region-box"
          key={region.id}
          style={{
            left: `${region.x * 100}%`,
            top: `${region.y * 100}%`,
            width: `${region.width * 100}%`,
            height: `${region.height * 100}%`
          }}
        >
          <span>{region.name}</span>
        </div>
      ))}
    </div>
  );
}
