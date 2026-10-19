import { useParams } from "react-router";
import { useUploadLimits } from "../features/settings";
import { WorkflowBuilder } from "../features/workflow";

export function WorkflowPage() {
  const { workflowId = "" } = useParams();
  const { uploadMaxBatchFiles, uploadChunkFiles } = useUploadLimits();
  return (
    <WorkflowBuilder
      uploadMaxBatchFiles={uploadMaxBatchFiles}
      uploadChunkFiles={uploadChunkFiles}
      initialWorkflowId={workflowId}
    />
  );
}
