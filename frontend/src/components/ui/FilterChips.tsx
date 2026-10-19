import { CountBadge } from "./StatusBadge";

export type FilterChipOption<T extends string> = { value: T; label: string; count?: number };

/** 결과 필터(전체 / 검토 필요 / 수정됨 / 경고 …). 탭 역할로 노출한다. */
export function FilterChips<T extends string>(props: {
  options: FilterChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={["ui-filter-chips", props.className ?? ""].filter(Boolean).join(" ")} role="tablist" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={props.value === option.value}
          className={props.value === option.value ? "active" : ""}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <CountBadge count={option.count} />}
        </button>
      ))}
    </div>
  );
}
