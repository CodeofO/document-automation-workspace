import { useSearchParams } from "react-router";
import { useHandedOffDocuments } from "../library";
import { ModuleWorkspace } from "../module-batch";
import { useUploadLimits } from "../settings";
import { requiredCheckModule } from "./config";

/** 필수 항목 확인 화면. h1은 상단바가 라우트 제목("필수 항목 확인")으로 그린다. ?batch=<id>면 그 배치를 연다. */
export function RequiredCheckPage() {
  const { uploadMaxBatchFiles, uploadChunkFiles } = useUploadLimits();
  const documents = useHandedOffDocuments("required-checker");
  const [params] = useSearchParams();
  return (
    <ModuleWorkspace
      config={requiredCheckModule}
      uploadMaxBatchFiles={uploadMaxBatchFiles}
      uploadChunkFiles={uploadChunkFiles}
      initialLibraryDocuments={documents}
      initialBatchId={params.get("batch")}
    />
  );
}
