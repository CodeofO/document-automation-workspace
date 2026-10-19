import { useNavigate } from "react-router";
import { MODULE_TARGET_PATHS } from "../app/routes";
import { DocumentLibraryScreen, handOffLibraryDocuments } from "../features/library";
import { useUploadLimits } from "../features/settings";

export function DocumentsPage() {
  const navigate = useNavigate();
  const { uploadChunkFiles } = useUploadLimits();
  return (
    <DocumentLibraryScreen
      uploadChunkFiles={uploadChunkFiles}
      onRunSelected={(target, documents) => {
        if (!documents.length) return;
        handOffLibraryDocuments(target, target === "raw" ? documents.slice(0, 1) : documents);
        navigate(MODULE_TARGET_PATHS[target]);
      }}
    />
  );
}
