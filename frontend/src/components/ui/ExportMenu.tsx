import { ChevronDown, Download, FileJson, FileSpreadsheet, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toFriendlyError } from "../../api/client";
import { buttonClassName } from "./Button";
import { MenuList, useMenu } from "./Menu";
import { useToast } from "./Toast";

export type ExportFormat = "json" | "csv" | "xlsx";

/** href(즉시 다운로드 링크) 또는 onExport(비동기 export job) 중 하나. */
export type ExportMenuOption = {
  format: ExportFormat;
  label?: string;
  href?: string;
  onExport?: () => Promise<unknown> | unknown;
};

/** 메뉴 순서(spec B-4): JSON / CSV / XLSX */
export const EXPORT_FORMATS: ExportFormat[] = ["json", "csv", "xlsx"];

export function exportFormatIcon(format: ExportFormat, size: number) {
  if (format === "json") return <FileJson size={size} />;
  if (format === "xlsx") return <FileSpreadsheet size={size} />;
  return <Download size={size} />;
}

/** 단건·배치 공용 Export 메뉴. 실패는 토스트로 알린다. */
export function ExportMenu(props: {
  options: ExportMenuOption[];
  compact?: boolean;
  align?: "left" | "right";
  /** overflow:hidden 컨테이너 안이면 true */
  fixed?: boolean;
  title?: string;
  label?: string;
  /** 메뉴 아래쪽에 붙일 내용(예: 최근 export 이력). */
  footer?: ReactNode;
  disabled?: boolean;
}) {
  const { open, ref, toggle, close, menuStyle, fixed } = useMenu({ fixed: props.fixed, placement: props.align });
  const toast = useToast();
  const [pendingFormat, setPendingFormat] = useState<ExportFormat | null>(null);
  const iconSize = props.compact ? 14 : 16;
  const options = [...props.options].sort((a, b) => EXPORT_FORMATS.indexOf(a.format) - EXPORT_FORMATS.indexOf(b.format));

  const runExport = async (option: ExportMenuOption) => {
    if (!option.onExport || pendingFormat) return;
    close();
    setPendingFormat(option.format);
    try {
      await option.onExport();
    } catch (error) {
      toast.show(toFriendlyError(error) || "Export 요청에 실패했습니다.", { tone: "danger" });
    } finally {
      setPendingFormat(null);
    }
  };

  return (
    <div className="workflow-upload-picker unified-upload-picker" ref={ref}>
      <button
        type="button"
        className={buttonClassName("secondary", props.compact ? "sm" : "md")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={props.title}
        disabled={pendingFormat !== null || props.disabled}
        onClick={toggle}
      >
        {pendingFormat ? <Loader2 size={iconSize} className="spin" /> : <Download size={iconSize} />}
        {props.label ?? "Export"}
        <ChevronDown size={14} />
      </button>
      {open && (
        <MenuList align={props.align} fixed={fixed} style={menuStyle} label="Export 형식">
          {options.map((option) =>
            option.onExport ? (
              <button
                key={option.format}
                type="button"
                className="workflow-upload-menu-item"
                role="menuitem"
                disabled={pendingFormat !== null}
                onClick={() => void runExport(option)}
              >
                {pendingFormat === option.format ? (
                  <Loader2 size={iconSize} className="spin" />
                ) : (
                  exportFormatIcon(option.format, iconSize)
                )}{" "}
                {option.label ?? option.format.toUpperCase()}
              </button>
            ) : (
              <a
                key={option.format}
                className="workflow-upload-menu-item"
                role="menuitem"
                href={option.href}
                target="_blank"
                rel="noreferrer"
                onClick={close}
              >
                {exportFormatIcon(option.format, iconSize)} {option.label ?? option.format.toUpperCase()}
              </a>
            )
          )}
          {props.footer && <div className="ui-export-menu-footer">{props.footer}</div>}
        </MenuList>
      )}
    </div>
  );
}
