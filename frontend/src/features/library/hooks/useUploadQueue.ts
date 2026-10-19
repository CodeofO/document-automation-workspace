import { useCallback, useRef, useState } from "react";
import { toFriendlyError } from "../../../api/client";
import type { LibraryDocument } from "../../../api/types";
import { chunkFiles } from "../../../lib/files";
import { uploadLibraryFiles } from "../api";
import { DEFAULT_LIBRARY_UPLOAD_CHUNK_FILES, newUploadQueueId, type UploadQueueItem } from "../model";
import { useLatestRef } from "./useLatestRef";

type UploadQueueCallbacks = {
  /** 청크 하나가 올라갈 때마다. 목록에 바로 반영한다. */
  onChunkUploaded: (documents: LibraryDocument[]) => void;
  /** 항목 하나가 끝났을 때(올라간 문서 전체). */
  onItemCompleted: (documents: LibraryDocument[]) => Promise<void> | void;
  onItemFailed: (error: unknown) => void;
};

/**
 * 순차 업로드 큐. 업로드 중에도 항목을 더 넣을 수 있고, 한 번에 한 항목씩 청크로 올린다.
 * (effect가 아니라 enqueue가 직접 처리 루프를 깨운다)
 */
export function useUploadQueue(options: { chunkSize?: number } & UploadQueueCallbacks) {
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const pendingRef = useRef<UploadQueueItem[]>([]);
  const runningRef = useRef(false);
  const latest = useLatestRef(options);

  const patch = useCallback((id: string, changes: Partial<UploadQueueItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (let item = pendingRef.current.shift(); item; item = pendingRef.current.shift()) {
        patch(item.id, { status: "uploading", error: null });
        try {
          let uploadedCount = 0;
          const uploaded: LibraryDocument[] = [];
          const chunkSize = Math.max(1, latest.current.chunkSize ?? DEFAULT_LIBRARY_UPLOAD_CHUNK_FILES);
          for (const chunk of chunkFiles(item.files, chunkSize)) {
            const documents = await uploadLibraryFiles(chunk, item.targetFolder);
            uploaded.push(...documents);
            uploadedCount += chunk.length;
            patch(item.id, { uploadedCount });
            latest.current.onChunkUploaded(documents);
          }
          patch(item.id, { status: "completed", uploadedCount });
          await latest.current.onItemCompleted(uploaded);
        } catch (error) {
          patch(item.id, { status: "failed", error: toFriendlyError(error) });
          latest.current.onItemFailed(error);
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [latest, patch]);

  const enqueue = useCallback(
    (files: File[], label: string, targetFolder: string) => {
      const item: UploadQueueItem = {
        id: newUploadQueueId(),
        label: targetFolder ? `${label} → ${targetFolder}` : label,
        files,
        targetFolder,
        status: "pending",
        uploadedCount: 0,
        error: null
      };
      pendingRef.current.push(item);
      setItems((current) => [...current, item]);
      void pump();
    },
    [pump]
  );

  const pendingCount = items.filter((item) => item.status === "pending" || item.status === "uploading").length;
  return { items, pendingCount, enqueue };
}
