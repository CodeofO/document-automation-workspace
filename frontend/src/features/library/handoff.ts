// 보관함 → 모듈 화면으로 "선택 문서로 실행"할 때 문서 목록을 넘기는 작은 저장소.
// (예전 App의 initialLibraryDocuments / onConsumeInitialLibraryDocuments props를 대체)
import { useEffect, useState } from "react";
import type { LibraryDocument } from "../../api/types";
import type { ModuleTarget } from "../../app/routes";

const pending = new Map<ModuleTarget, LibraryDocument[]>();

export function handOffLibraryDocuments(target: ModuleTarget, documents: LibraryDocument[]) {
  if (documents.length) pending.set(target, documents);
  else pending.delete(target);
}

export function peekHandedOffDocuments(target: ModuleTarget): LibraryDocument[] {
  return pending.get(target) ?? [];
}

export function clearHandedOffDocuments(target: ModuleTarget) {
  pending.delete(target);
}

/**
 * 화면이 마운트될 때 넘겨받은 문서를 한 번 읽는다. 읽은 뒤 저장소는 비운다.
 * (StrictMode에서 초기화 함수가 두 번 불려도 같은 값이 나오도록 peek 후 effect에서 비운다)
 */
export function useHandedOffDocuments(target: ModuleTarget): LibraryDocument[] {
  const [documents] = useState(() => peekHandedOffDocuments(target));
  useEffect(() => {
    clearHandedOffDocuments(target);
  }, [target]);
  return documents;
}
