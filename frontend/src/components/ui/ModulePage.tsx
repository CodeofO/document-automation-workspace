import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./Button";

/**
 * 모듈 화면 뼈대(spec B-1): PageHeader → 알림(InlineAlert) → JobStatusBar → 본문(SplitPane).
 * 모든 모듈(보관함·원문·KIE·분류·필수항목·회전·Export 이력)이 같은 여백·폭을 쓴다.
 */
export function ModulePage(props: {
  /** data-module 값(스타일·테스트용) */
  module: string;
  header: ReactNode;
  /** PageHeader 아래 InlineAlert 묶음. 없으면 그리지 않는다. */
  alerts?: ReactNode;
  statusBar?: ReactNode;
  children: ReactNode;
  className?: string;
  /** 본문이 스스로 스크롤하지 않고 페이지 전체가 스크롤되는 화면(Export 이력 등) */
  scroll?: boolean;
}) {
  return (
    <main
      className={["ui-module-page", props.scroll ? "scroll" : "", props.className ?? ""].filter(Boolean).join(" ")}
      data-module={props.module}
    >
      {props.header}
      {props.alerts ? (
        <div className="ui-module-alerts" aria-live="polite">
          {props.alerts}
        </div>
      ) : null}
      {props.statusBar}
      <div className="ui-module-body">{props.children}</div>
    </main>
  );
}

/** 모듈 화면의 카드(정의·결과·기록). 헤더: eyebrow · 제목 · 액션, 본문, 하단 액션. */
export function Card(props: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** 본문이 남은 높이를 채우고 스크롤한다. */
  fill?: boolean;
  headingLevel?: 2 | 3;
  /** 접을 수 있는 카드: onToggle을 주면 헤더에 접기/펼치기 버튼이 생긴다. */
  collapsed?: boolean;
  onToggle?: () => void;
  /** 접혔을 때 헤더 아래에 보일 한 줄 요약 */
  summary?: ReactNode;
}) {
  const Heading = props.headingLevel === 3 ? "h3" : "h2";
  const collapsed = Boolean(props.collapsed);
  return (
    <section
      className={["ui-card", props.fill ? "fill" : "", collapsed ? "collapsed" : "", props.className ?? ""].filter(Boolean).join(" ")}
    >
      {(props.eyebrow || props.title || props.actions || props.onToggle) && (
        <header className="ui-card-header">
          <div className="ui-card-heading">
            {props.eyebrow && <p className="eyebrow">{props.eyebrow}</p>}
            {props.title && <Heading>{props.title}</Heading>}
          </div>
          {(props.actions || props.onToggle) && (
            <div className="ui-card-actions">
              {props.actions}
              {props.onToggle && (
                <IconButton size="sm" variant="ghost" label={collapsed ? "펼치기" : "접기"} aria-expanded={!collapsed} onClick={props.onToggle}>
                  {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </IconButton>
              )}
            </div>
          )}
        </header>
      )}
      {collapsed && props.summary && <div className="ui-card-summary">{props.summary}</div>}
      {!collapsed && props.children !== undefined && <div className="ui-card-body">{props.children}</div>}
      {!collapsed && props.footer && <footer className="ui-card-footer">{props.footer}</footer>}
    </section>
  );
}
