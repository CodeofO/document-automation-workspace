import { useParams } from "react-router";
import { WorkflowRunResultWindow } from "../features/workflow";

export function WorkflowRunPage() {
  const { runId = "" } = useParams();
  return <WorkflowRunResultWindow key={runId} runId={runId} />;
}
