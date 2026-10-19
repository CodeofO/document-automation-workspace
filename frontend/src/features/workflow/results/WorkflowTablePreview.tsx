// 결과 창 "표 추출" 섹션: 노드 결과 요약(표·행·검토 칸·위반) + 표마다 읽기 전용 미리보기(앞 20행).
// 설계 §7-5: 결과 창은 읽기 전용, 수정은 "검토 화면에서 열기"(/tables?job=…)에서 한다.
import { Link } from "react-router";
import { tablesPath } from "../../../app/routes";
import { StatusBadge } from "../../../components/ui";
import {
  cellTone,
  effectiveTables,
  formatCellValue,
  useTableJob,
  type TableResult,
  type WorkflowTableNodeResult
} from "../../table-extraction";

export const TABLE_PREVIEW_ROWS = 20;

export function WorkflowTableNodeResultView({ nodeId, table }: { nodeId: string; table: WorkflowTableNodeResult }) {
  const jobQuery = useTableJob(table.job_id ?? null);
  const results = effectiveTables(jobQuery.data?.result);
  const reviewPath = table.job_id ? tablesPath({ job: table.job_id }) : null;
  const summaries = table.tables ?? [];
  return (
    <div className="workflow-table-result" data-node-id={nodeId}>
      <div className="workflow-table-result-head">
        <StatusBadge status={table.status ?? null} />
        {reviewPath && (
          <Link className="wf-link" to={reviewPath} target="_blank" rel="noreferrer">
            검토 화면에서 열기
          </Link>
        )}
      </div>
      {table.error_message && <div className="module-error">{table.error_message}</div>}
      {summaries.length ? (
        <div className="wf-docres-table-wrap">
          <table className="wf-docres-table wf-table-summary" aria-label="표 추출 요약">
            <thead>
              <tr>
                <th scope="col">표</th>
                <th scope="col">행</th>
                <th scope="col">검토 칸</th>
                <th scope="col">위반</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((entry) => (
                <tr
                  key={entry.key}
                  data-tone={entry.violations ? "danger" : entry.review_cells ? "warning" : undefined}
                >
                  <td title={entry.key}>{entry.name || entry.key}</td>
                  <td>{entry.row_count.toLocaleString()}</td>
                  <td>{entry.review_cells.toLocaleString()}</td>
                  <td>{entry.violations.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="wf-result-muted">표시할 표 결과가 없습니다.</p>
      )}
      {jobQuery.isLoading && summaries.length > 0 && (
        <p className="wf-result-muted">표 미리보기를 불러오는 중입니다.</p>
      )}
      {results.map((result) => (
        <TablePreview key={result.table_key} table={result} reviewPath={reviewPath} />
      ))}
    </div>
  );
}

function TablePreview({ table, reviewPath }: { table: TableResult; reviewPath: string | null }) {
  const rows = table.rows.slice(0, TABLE_PREVIEW_ROWS);
  const hidden = table.rows.length - rows.length;
  return (
    <figure className="wf-table-preview">
      <figcaption>
        <strong>{table.table_name}</strong>
        <span className="wf-result-section-meta">{table.rows.length.toLocaleString()}행</span>
        {reviewPath && (
          <Link
            className="wf-link"
            to={reviewPath}
            target="_blank"
            rel="noreferrer"
            aria-label={`${table.table_name} 전체 보기`}
          >
            전체 보기
          </Link>
        )}
      </figcaption>
      {table.status === "failed" ? (
        <p className="wf-result-muted">이 표를 읽지 못했습니다. {table.error ?? ""}</p>
      ) : (
        <div className="wf-docres-table-wrap">
          <table className="wf-docres-table wf-table-preview-grid" aria-label={`${table.table_name} 미리보기`}>
            <thead>
              <tr>
                <th scope="col" className="wf-table-preview-index">
                  #
                </th>
                {table.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row, index) => (
                  <tr key={row.row_id} data-violation={row.violations.length > 0 || undefined}>
                    <td className="wf-table-preview-index">{row.row_index ?? index + 1}</td>
                    {table.columns.map((column) => {
                      const cell = row.cells[column];
                      return (
                        <td key={column} data-tone={cellTone(cell) ?? undefined} title={cell?.raw ?? undefined}>
                          {formatCellValue(cell) || <span className="muted">–</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={table.columns.length + 1} className="wf-result-muted">
                    읽은 행이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {hidden > 0 && <p className="wf-result-muted">외 {hidden.toLocaleString()}행은 검토 화면에서 볼 수 있습니다.</p>}
    </figure>
  );
}
