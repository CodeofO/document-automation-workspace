import type { StatusTone } from "../../lib/status";

/** 카운터 하나(라벨 + 숫자). 순서는 전체 · 완료 · 검토 필요 · 실패 · (모듈별 추가)로 쓴다. */
export function StatCounter(props: { label: string; value: number; tone?: StatusTone }) {
  return (
    <div className="ui-stat-counter" data-tone={props.tone ?? "neutral"}>
      <span>{props.label}</span>
      <strong>{props.value.toLocaleString()}</strong>
    </div>
  );
}

export function StatCounterRow(props: { items: { label: string; value: number; tone?: StatusTone }[]; label?: string }) {
  return (
    <div className="ui-stat-counter-row" aria-label={props.label}>
      {props.items.map((item) => (
        <StatCounter key={item.label} {...item} />
      ))}
    </div>
  );
}
