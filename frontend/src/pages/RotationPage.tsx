import { useSearchParams } from "react-router";
import { useHandedOffDocuments } from "../features/library";
import { RotationWorkspace } from "../features/rotation";
import { useUploadLimits } from "../features/settings";

export function RotationPage() {
  const { uploadChunkFiles, uploadMaxBatchFiles } = useUploadLimits();
  const documents = useHandedOffDocuments("rotation");
  const [params] = useSearchParams();
  return (
    <RotationWorkspace
      uploadChunkFiles={uploadChunkFiles}
      uploadMaxBatchFiles={uploadMaxBatchFiles}
      initialLibraryDocuments={documents}
      initialBatchId={params.get("batch")}
    />
  );
}
