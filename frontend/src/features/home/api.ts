import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { POLL_IDLE_MS, POLL_RUNNING_MS } from "../../api/polling";
import { buildHomeMonitorItems, hasRunningHomeItems, type HomeModuleBatch, type HomeWorkflowRun } from "./monitor";

type HomeMonitorData = {
  workflowRuns: HomeWorkflowRun[];
  kieBatches: HomeModuleBatch[];
  classificationBatches: HomeModuleBatch[];
  requiredBatches: HomeModuleBatch[];
  rotationBatches: HomeModuleBatch[];
  tableBatches: HomeModuleBatch[];
};

// 목록 하나가 실패해도 나머지는 보여준다(홈 모니터는 보조 정보).
async function listOrEmpty<T>(path: string): Promise<T[]> {
  try {
    return await api<T[]>(path);
  } catch {
    return [];
  }
}

async function fetchHomeMonitor(): Promise<HomeMonitorData> {
  const [workflowRuns, kieBatches, classificationBatches, requiredBatches, rotationBatches, tableBatches] = await Promise.all([
    listOrEmpty<HomeWorkflowRun>("/api/workflow-runs?limit=6"),
    listOrEmpty<HomeModuleBatch>("/api/batches?limit=12"),
    listOrEmpty<HomeModuleBatch>("/api/classification-batches?limit=6&include_items=false"),
    listOrEmpty<HomeModuleBatch>("/api/required-field-check-batches?limit=6&include_items=false"),
    listOrEmpty<HomeModuleBatch>("/api/rotation-batches?limit=6&include_items=false"),
    listOrEmpty<HomeModuleBatch>("/api/table-extraction-batches?limit=6&include_items=false")
  ]);
  return { workflowRuns, kieBatches, classificationBatches, requiredBatches, rotationBatches, tableBatches };
}

function allRows(data: HomeMonitorData) {
  return [
    ...data.workflowRuns,
    ...data.kieBatches,
    ...data.classificationBatches,
    ...data.requiredBatches,
    ...data.rotationBatches,
    ...data.tableBatches
  ];
}

/** 홈 모니터: 실행 중인 항목이 있으면 1.5초, 아니면 6초마다 갱신한다. */
export function useHomeMonitor() {
  const query = useQuery({
    queryKey: ["home", "monitor"],
    queryFn: fetchHomeMonitor,
    refetchInterval: (current) =>
      current.state.data && hasRunningHomeItems(allRows(current.state.data)) ? POLL_RUNNING_MS : POLL_IDLE_MS
  });
  const data = query.data;
  const items = data
    ? buildHomeMonitorItems(
        data.workflowRuns,
        data.kieBatches,
        data.classificationBatches,
        data.requiredBatches,
        data.rotationBatches,
        data.tableBatches
      )
    : [];
  return { ...query, items };
}
