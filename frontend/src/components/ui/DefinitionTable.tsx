import { Plus, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Button, IconButton } from "./Button";

export type DefinitionColumn<T> = {
  key: string;
  header: ReactNode;
  /** CSS width (예: "28%", "120px") */
  width?: string;
  align?: "left" | "center";
  render: (row: T, index: number) => ReactNode;
};

/**
 * 정의 편집 표(spec B-5): Schema 필드 · 분류 클래스 · 체크리스트 항목.
 * <table> 하나, sticky 헤더, 행 최소 40px, 마지막 열은 삭제 IconButton(danger).
 */
export function DefinitionTable<T>(props: {
  label: string;
  columns: DefinitionColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRemove?: (index: number) => void;
  removeLabel?: (row: T, index: number) => string;
  onAdd?: () => void;
  addLabel?: string;
  /** 표 아래 추가 버튼 옆에 붙일 액션 */
  footerActions?: ReactNode;
  emptyText?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["ui-definition-table-block", props.className ?? ""].filter(Boolean).join(" ")}>
      <div className="ui-definition-table-wrap">
        <table className="ui-definition-table" aria-label={props.label}>
          <colgroup>
            {props.columns.map((column) => (
              <col key={column.key} style={column.width ? { width: column.width } : undefined} />
            ))}
            {props.onRemove && <col style={{ width: "44px" }} />}
          </colgroup>
          <thead>
            <tr>
              {props.columns.map((column) => (
                <th key={column.key} scope="col" data-align={column.align}>
                  {column.header}
                </th>
              ))}
              {props.onRemove && (
                <th scope="col">
                  <span className="visually-hidden">삭제</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {props.rows.length ? (
              props.rows.map((row, index) => (
                <tr key={props.rowKey(row, index)}>
                  {props.columns.map((column) => (
                    <td key={column.key} data-align={column.align}>
                      {column.render(row, index)}
                    </td>
                  ))}
                  {props.onRemove && (
                    <td className="ui-definition-remove">
                      <IconButton
                        size="sm"
                        variant="danger-ghost"
                        label={props.removeLabel?.(row, index) ?? `${index + 1}행 삭제`}
                        onClick={() => props.onRemove?.(index)}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td className="ui-definition-empty" colSpan={props.columns.length + (props.onRemove ? 1 : 0)}>
                  {props.emptyText ?? "항목이 없습니다."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(props.onAdd || props.footerActions) && (
        <div className="ui-definition-table-footer">
          {props.onAdd && (
            <Button size="sm" icon={<Plus size={14} />} onClick={props.onAdd}>
              {props.addLabel ?? "행 추가"}
            </Button>
          )}
          {props.footerActions}
        </div>
      )}
    </div>
  );
}

/** 내용에 맞춰 높이가 늘어나는 textarea(정의 표 셀용). */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const { className, ...rest } = props;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} className={["ui-auto-textarea", className ?? ""].filter(Boolean).join(" ")} {...rest} />;
}
