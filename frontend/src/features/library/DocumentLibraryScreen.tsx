import { useState } from "react";
import type { LibraryDocument } from "../../api/types";
import type { ModuleTarget } from "../../app/routes";
import { ModulePage, PageHeader } from "../../components/ui";
import { DocumentLibraryPanel } from "./DocumentLibraryPanel";

/** /documents 화면. 선택한 문서를 모듈로 보내는 일은 page가 맡는다(onRunSelected). */
export function DocumentLibraryScreen(props: {
  uploadChunkFiles?: number;
  onRunSelected: (target: ModuleTarget, documents: LibraryDocument[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  return (
    <ModulePage
      module="documents"
      header={
        <PageHeader
          eyebrow="문서 보관함"
          title="업로드한 문서를 보관하고 준비되면 실행합니다"
          description="업로드·변환은 뒤에서 처리됩니다. 문서를 고른 뒤 아래 작업으로 보내면 페이지 단위로 실행합니다."
        />
      }
    >
      <DocumentLibraryPanel
        mode="screen"
        uploadChunkFiles={props.uploadChunkFiles}
        selectedIds={selectedIds}
        onSelectedIds={setSelectedIds}
        onRunSelected={props.onRunSelected}
      />
    </ModulePage>
  );
}
