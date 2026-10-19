import { useQuery } from "@tanstack/react-query";
import { POLL_RUNNING_MS } from "../../../api/polling";
import { isActiveStatus } from "../../../lib/status";
import { documentKeys, fetchDocumentDetail } from "../api";

/** 뷰어용 문서 상세(페이지 포함). 변환 중이면 준비될 때까지 1.5초마다 다시 읽는다. */
export function useDocumentDetail(documentId: string | null | undefined) {
  return useQuery({
    queryKey: documentKeys.detail(documentId ?? ""),
    queryFn: ({ signal }) => fetchDocumentDetail(documentId as string, signal),
    enabled: Boolean(documentId),
    staleTime: 30_000,
    refetchInterval: (query) => (isActiveStatus(query.state.data?.status) ? POLL_RUNNING_MS : false)
  });
}
