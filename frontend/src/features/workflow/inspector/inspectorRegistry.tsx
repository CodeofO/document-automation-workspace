// 노드 종류별 Inspector 설정 섹션. 새 노드 종류는 여기에 한 줄을 더한다.
import { ArrowRight, ExternalLink, FilePlus2, PencilLine, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui";
import { branchKeyLabel, normalizeBranchKeys } from "../model/graph";
import { tableTemplatePath } from "../../../app/routes";
import { nodeAssetInfo, tableNodeInfo, type WorkflowDraftMaps } from "../model/nodeAssets";
import type { WorkflowAssets, WorkflowEdge, WorkflowNode, WorkflowNodeKind } from "../types";
import { InspectorSection } from "./InspectorParts";

export type NodeInspectorContext = {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  assets: WorkflowAssets;
  drafts: WorkflowDraftMaps;
  updateNodeConfig: (nodeId: string, key: string, value: string) => void;
  onOpenAssetEditor: (nodeId: string) => void;
  onStartNewDraft: (node: WorkflowNode) => void;
  onDiscardDraft: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
};

const SUMMARY_LIMIT = 5;

function nodeLabelById(nodes: WorkflowNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId)?.data.label ?? nodeId;
}

/** classifier·kie·required-checker: 에셋 선택, 요약(개수·상위 5개), 편집·새 초안. */
function AssetSettings({ ctx }: { ctx: NodeInspectorContext }) {
  const info = nodeAssetInfo(ctx.node, ctx.assets, ctx.drafts);
  if (!info) return null;
  const extra = info.items.length - SUMMARY_LIMIT;
  const hasAsset = info.hasDraft || info.hasSaved;
  return (
    <InspectorSection title={info.label}>
      <label className="wf-field">
        <select
          value={info.selectedId}
          onChange={(event) => ctx.updateNodeConfig(ctx.node.id, info.configKey, event.target.value)}
          aria-label={`${info.label} 선택`}
          data-inspector-first-field
        >
          <option value="">{info.hasDraft && !info.selectedId ? "새 초안(미저장)" : info.placeholder}</option>
          {info.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {info.hasDraft && (
        <div className="wf-draft-note" role="note">
          <span>
            <b>● 미저장 초안</b>
            {info.selectedId
              ? ` 저장하면 선택한 ${info.label}에 반영됩니다.`
              : ` 저장하면 새 ${info.label}로 만들어집니다.`}
          </span>
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => ctx.onDiscardDraft(ctx.node.id)}>
            초안 버리기
          </Button>
        </div>
      )}

      {hasAsset ? (
        <div className="wf-asset-summary" role="region" aria-label={`${info.label} 요약`}>
          <div className="wf-asset-summary-head">
            <strong title={info.name}>{info.name || "이름 없음"}</strong>
            <span>
              {info.items.length.toLocaleString()}
              {info.unit}
            </span>
          </div>
          {info.items.length > 0 && (
            <ul>
              {info.items.slice(0, SUMMARY_LIMIT).map((item, index) => (
                <li key={`${item}-${index}`} title={item}>
                  {item}
                </li>
              ))}
              {extra > 0 && <li className="wf-asset-summary-more">+{extra.toLocaleString()}개</li>}
            </ul>
          )}
        </div>
      ) : (
        <p className="wf-inspector-muted">
          저장된 {info.label}를 고르거나 새 초안을 만드세요.
        </p>
      )}

      <div className="wf-inspector-actions">
        <Button
          size="sm"
          variant="primary"
          icon={<PencilLine size={14} />}
          onClick={() => ctx.onOpenAssetEditor(ctx.node.id)}
          title="에셋 편집 열기 (Enter)"
        >
          에셋 편집
        </Button>
        <Button size="sm" icon={<FilePlus2 size={14} />} onClick={() => ctx.onStartNewDraft(ctx.node)}>
          새 초안
        </Button>
      </div>
    </InspectorSection>
  );
}

/** 양식 편집기는 별도 화면이라 새 탭으로 연다(캔버스 편집 상태를 잃지 않게). */
function openInNewTab(path: string) {
  window.open(path, "_blank", "noopener");
}

/** table: 표 양식 선택, 요약(표 N개 · 칼럼 수), 실행할 표(선택, 비우면 전체), 양식 편집. */
function TableSettings({ ctx }: { ctx: NodeInspectorContext }) {
  const info = tableNodeInfo(ctx.node, ctx.assets);
  if (!info) return null;
  const templates = ctx.assets.tableTemplates ?? [];
  const template = info.template;
  const allKeys = template?.tables.map((table) => table.key) ?? [];
  const selectedKeys = info.tableKeys.length ? info.tableKeys.filter((key) => allKeys.includes(key)) : allKeys;
  const columnCount = template?.tables.reduce((sum, table) => sum + table.columns.length, 0) ?? 0;

  function toggleKey(key: string, checked: boolean) {
    const next = checked ? [...selectedKeys, key] : selectedKeys.filter((item) => item !== key);
    const ordered = allKeys.filter((item) => next.includes(item));
    // 전부 고르면 비운다(= 양식의 표 전체 실행). 하나도 안 고르는 것은 막는다.
    if (!ordered.length) return;
    ctx.updateNodeConfig(ctx.node.id, "table_keys", ordered.length === allKeys.length ? "" : ordered.join(","));
  }

  return (
    <InspectorSection title="표 양식">
      <label className="wf-field">
        <select
          value={info.templateId}
          onChange={(event) => {
            ctx.updateNodeConfig(ctx.node.id, "template_id", event.target.value);
            ctx.updateNodeConfig(ctx.node.id, "table_keys", "");
          }}
          aria-label="표 양식 선택"
          data-inspector-first-field
        >
          <option value="">표 양식 선택</option>
          {info.templateId && !template && <option value={info.templateId}>찾을 수 없는 양식</option>}
          {templates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.display_name || item.name} · 표 {item.tables.length}개
            </option>
          ))}
        </select>
      </label>

      {template ? (
        <div className="wf-asset-summary" role="region" aria-label="표 양식 요약">
          <div className="wf-asset-summary-head">
            <strong title={template.name}>{template.display_name || template.name}</strong>
            <span>
              표 {template.tables.length.toLocaleString()}개 · 칼럼 {columnCount.toLocaleString()}개
            </span>
          </div>
          {template.tables.length > 0 && (
            <ul className="wf-table-keys" aria-label="실행할 표">
              {template.tables.map((table) => (
                <li key={table.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedKeys.includes(table.key)}
                      onChange={(event) => toggleKey(table.key, event.target.checked)}
                    />
                    <span title={table.key}>{table.name}</span>
                    <small>{table.columns.length}칼럼</small>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="wf-inspector-muted">체크한 표만 실행합니다. 모두 체크하면 양식의 표 전체를 실행합니다.</p>
        </div>
      ) : (
        <p className="wf-inspector-muted">저장된 표 양식을 고르세요. 양식은 표 추출 화면의 양식 편집기에서 만듭니다.</p>
      )}

      <div className="wf-inspector-actions">
        <Button
          size="sm"
          variant="primary"
          icon={<ExternalLink size={14} />}
          disabled={!template}
          onClick={() => template && openInNewTab(tableTemplatePath(template.id))}
          title="새 탭에서 양식 편집기를 엽니다. 저장하면 이 목록에 반영됩니다."
        >
          양식 편집
        </Button>
        <Button size="sm" icon={<FilePlus2 size={14} />} onClick={() => openInNewTab(tableTemplatePath())}>
          새 양식
        </Button>
      </div>
    </InspectorSection>
  );
}

/** branch: 분기 키와 각 키의 연결 상태. */
function BranchSettings({ ctx }: { ctx: NodeInspectorContext }) {
  const keys = normalizeBranchKeys(ctx.node.data.branchKeys);
  return (
    <InspectorSection title="분기 경로">
      <p className="wf-inspector-muted">분기 키는 앞의 문서 분류 노드의 class에서 자동으로 만들어집니다.</p>
      <ul className="wf-branch-list">
        {keys.map((key) => {
          const edge = ctx.edges.find((item) => item.source === ctx.node.id && item.sourceHandle === key);
          return (
            <li key={key} data-connected={edge ? "true" : "false"}>
              <span className="branch-route-dot" />
              <strong>{branchKeyLabel(key)}</strong>
              {edge ? (
                <button type="button" className="wf-link" onClick={() => ctx.onSelectNode(edge.target)}>
                  <ArrowRight size={13} /> {nodeLabelById(ctx.nodes, edge.target)}
                </button>
              ) : (
                <small>연결 없음 · 분류 결과만 export</small>
              )}
            </li>
          );
        })}
      </ul>
    </InspectorSection>
  );
}

/** 별도 설정이 없는 노드(input·rotation·merge·export). config가 있으면 그대로 편집할 수 있게 보여준다. */
function GenericSettings({ ctx, note }: { ctx: NodeInspectorContext; note: string }) {
  const entries = Object.entries(ctx.node.data.config ?? {});
  return (
    <InspectorSection title="설정">
      <p className="wf-inspector-muted">{note}</p>
      {entries.map(([key, value], index) => (
        <label key={key} className="wf-field">
          <span>{key}</span>
          <input
            value={value}
            onChange={(event) => ctx.updateNodeConfig(ctx.node.id, key, event.target.value)}
            data-inspector-first-field={index === 0 ? true : undefined}
          />
        </label>
      ))}
    </InspectorSection>
  );
}

export const inspectorRegistry: Record<WorkflowNodeKind, (ctx: NodeInspectorContext) => ReactNode> = {
  input: (ctx) => <GenericSettings ctx={ctx} note="실행할 문서가 들어오는 시작점입니다. 문서는 툴바에서 고릅니다." />,
  classifier: (ctx) => <AssetSettings ctx={ctx} />,
  branch: (ctx) => <BranchSettings ctx={ctx} />,
  kie: (ctx) => <AssetSettings ctx={ctx} />,
  "required-checker": (ctx) => <AssetSettings ctx={ctx} />,
  table: (ctx) => <TableSettings ctx={ctx} />,
  rotation: (ctx) => <GenericSettings ctx={ctx} note="페이지 방향을 자동으로 감지해 정방향으로 보정합니다. 별도 설정은 없습니다." />,
  merge: (ctx) => <GenericSettings ctx={ctx} note="실행된 branch 결과를 하나로 합칩니다. 별도 설정은 없습니다." />,
  export: (ctx) => <GenericSettings ctx={ctx} note="통합 결과 파일을 만듭니다. 별도 설정은 없습니다." />
};
