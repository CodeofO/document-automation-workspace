import { useSearchParams } from "react-router";
import { useHandedOffDocuments } from "../library";
import { ModuleWorkspace } from "../module-batch";
import { useUploadLimits } from "../settings";
import { classifierModule } from "./config";

/** 문서 분류 화면. h1은 상단바가 라우트 제목("문서 분류")으로 그린다. ?batch=<id>면 그 배치를 연다. */
export function ClassifierPage() {
  const { uploadMaxBatchFiles, uploadChunkFiles } = useUploadLimits();
  const documents = useHandedOffDocuments("classifier");
  const [params] = useSearchParams();
  return (
    <ModuleWorkspace
      config={classifierModule}
      uploadMaxBatchFiles={uploadMaxBatchFiles}
      uploadChunkFiles={uploadChunkFiles}
      initialLibraryDocuments={documents}
      initialBatchId={params.get("batch")}
    />
  );
}
