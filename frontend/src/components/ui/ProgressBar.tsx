import { clamp01, percent } from "../../lib/format";

/** 0~1 진행률 막대. showLabel이면 오른쪽에 %를 붙인다. */
export function ProgressBar(props: { value: number; label?: string; showLabel?: boolean; className?: string }) {
  const value = clamp01(props.value);
  return (
    <div className={["ui-progress", props.className ?? ""].filter(Boolean).join(" ")}>
      <div
        className="ui-progress-track"
        role="progressbar"
        aria-label={props.label ?? "진행률"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent(value)}
      >
        <span style={{ width: `${percent(value)}%` }} />
      </div>
      {props.showLabel && <strong>{percent(value)}%</strong>}
    </div>
  );
}
