// 결과 창 오른쪽 패널의 섹션 카드(접기/펴기)와 근거 글(2줄 말줄임 + 펼치기).
// 섹션은 자기 높이만큼 자란다. 세로 스크롤은 패널(.workflow-item-detail) 하나만 갖는다.
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

export type InspectorSectionProps = {
  id: string;
  title: string;
  /** 제목 옆 상태 배지 */
  badge?: ReactNode;
  /** "12필드 · 검토 3" 같은 개수 요약 */
  meta?: string;
  /** 결과가 없으면 펼칠 내용 없이 한 줄로만 보인다. */
  emptyText?: string;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
};

export function InspectorSection(props: InspectorSectionProps) {
  const headingId = `${props.id}-title`;
  if (props.emptyText !== undefined) {
    return (
      <section id={props.id} className="wf-result-section" data-empty="true" aria-labelledby={headingId}>
        <div className="wf-result-section-head">
          <h4 id={headingId}>{props.title}</h4>
          <span className="wf-result-section-empty">{props.emptyText}</span>
        </div>
      </section>
    );
  }
  const bodyId = `${props.id}-body`;
  return (
    <section id={props.id} className="wf-result-section" data-open={props.open} aria-labelledby={headingId}>
      <h4 className="wf-result-section-heading">
        <button
          type="button"
          id={headingId}
          className="wf-result-section-head"
          aria-expanded={props.open}
          aria-controls={bodyId}
          onClick={props.onToggle}
        >
          {props.open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          <span className="wf-result-section-title">{props.title}</span>
          {props.badge}
          {props.meta && <span className="wf-result-section-meta">{props.meta}</span>}
        </button>
      </h4>
      {props.open && (
        <div id={bodyId} className="wf-result-section-body">
          {props.children}
        </div>
      )}
    </section>
  );
}

/**
 * 근거 글: 기본 2줄 말줄임. 실제로 잘렸을 때만(폭에 따라 다름) "더 보기"를 보여 준다.
 * 잘림 여부는 ResizeObserver 콜백에서 잰다(패널 너비를 바꾸면 다시 잰다).
 */
export function EvidenceText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const measure = useCallback((node: HTMLSpanElement | null) => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setOverflowing(node.scrollHeight > node.clientHeight + 1));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  if (!text) return <span className="muted">–</span>;
  return (
    <div className="wf-evidence" data-clamped={!expanded}>
      <span ref={expanded ? undefined : measure} className="wf-evidence-text">
        {text}
      </span>
      {(overflowing || expanded) && (
        <button
          type="button"
          className="wf-evidence-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "접기" : "더 보기"}
        </button>
      )}
    </div>
  );
}
