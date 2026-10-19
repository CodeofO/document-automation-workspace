import { Copy, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button, IconButton } from "./Button";
import { Drawer } from "./Drawer";
import { EmptyState } from "./EmptyState";

export type DefinitionListItem = { id: string; name: string; summary: string };

/**
 * 저장된 정의 목록 Drawer(spec B-1): Schema / 분류 설정 / 체크리스트가 같은 목록을 쓴다.
 * 행: 이름·요약(누르면 불러오기) · 복제 · 삭제. extra로 모듈 고유 도구(예: Schema JSON 가져오기)를 붙인다.
 */
export function DefinitionListDrawer(props: {
  open: boolean;
  eyebrow: string;
  title: string;
  items: DefinitionListItem[];
  activeId: string | null;
  /** 저장 전 초안(활성 정의가 없을 때) */
  draftName?: string | null;
  newLabel?: string;
  onNew: () => void;
  onLoad: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  extra?: ReactNode;
}) {
  return (
    <Drawer open={props.open} eyebrow={props.eyebrow} title={props.title} width="min(520px, 100vw)" onClose={props.onClose}>
      <div className="ui-definition-list">
        <Button variant="primary" icon={<Plus size={16} />} onClick={props.onNew}>
          {props.newLabel ?? "새로 만들기"}
        </Button>
        <ul aria-label={props.title}>
          {props.draftName && (
            <li className="ui-definition-list-item active draft" aria-current="true">
              <div className="ui-definition-list-main">
                <strong>{props.draftName}</strong>
                <span>저장 전 초안 · 편집 중</span>
              </div>
            </li>
          )}
          {props.items.map((item) => (
            <li
              key={item.id}
              className={item.id === props.activeId ? "ui-definition-list-item active" : "ui-definition-list-item"}
              aria-current={item.id === props.activeId ? "true" : undefined}
            >
              <button type="button" className="ui-definition-list-main" onClick={() => props.onLoad(item.id)}>
                <strong>{item.name}</strong>
                <span>{item.summary}</span>
              </button>
              {props.onDuplicate && (
                <IconButton label={`${item.name} 복제`} size="sm" variant="ghost" onClick={() => props.onDuplicate?.(item.id)}>
                  <Copy size={15} />
                </IconButton>
              )}
              <IconButton label={`${item.name} 삭제`} size="sm" variant="danger-ghost" onClick={() => props.onDelete(item.id)}>
                <Trash2 size={15} />
              </IconButton>
            </li>
          ))}
        </ul>
        {!props.items.length && !props.draftName && <EmptyState compact title="저장된 항목이 없습니다." />}
        {props.extra}
      </div>
    </Drawer>
  );
}
