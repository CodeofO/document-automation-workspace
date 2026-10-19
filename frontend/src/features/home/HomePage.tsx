import { useNavigate } from "react-router";
import { ROUTES, workflowRunPath } from "../../app/routes";
import { useHomeMonitor } from "./api";
import { HomeScreen } from "./HomeScreen";
import type { HomeMonitorItem } from "./monitor";

const MODULE_PATHS: Record<Exclude<HomeMonitorItem["target"], "workflow">, string> = {
  "key-info": ROUTES.keyInfo,
  classifier: ROUTES.classifier,
  "required-checker": ROUTES.requiredCheck,
  rotation: ROUTES.rotation,
  table: ROUTES.tables
};

/** 모니터 행 → 화면 주소(run 결과 창 또는 모듈 화면 ?batch=). */
function homeMonitorItemPath(item: HomeMonitorItem): string {
  if (item.target === "workflow") return workflowRunPath(item.id);
  return `${MODULE_PATHS[item.target]}?batch=${encodeURIComponent(item.id)}`;
}

export function HomePage() {
  const navigate = useNavigate();
  const monitor = useHomeMonitor();

  return (
    <HomeScreen
      onDocuments={() => navigate(ROUTES.documents)}
      onRaw={() => navigate(ROUTES.raw)}
      onKie={() => navigate(ROUTES.keyInfo)}
      onTables={() => navigate(ROUTES.tables)}
      onClassifier={() => navigate(ROUTES.classifier)}
      onRequiredChecker={() => navigate(ROUTES.requiredCheck)}
      onRotation={() => navigate(ROUTES.rotation)}
      onWorkflow={() => navigate(ROUTES.workflows)}
      showMonitor
      monitorItems={monitor.items}
      onOpenMonitorItem={(item) => navigate(homeMonitorItemPath(item))}
    />
  );
}
