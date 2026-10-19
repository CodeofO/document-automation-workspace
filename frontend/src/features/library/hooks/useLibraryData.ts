import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { LibraryDocument } from "../../../api/types";
import { fetchLibraryDocuments, fetchLibraryFolders, libraryKeys, type LibraryFolder } from "../api";
import { libraryPollInterval, type LibraryFilters } from "../model";

const EMPTY_DOCUMENTS: LibraryDocument[] = [];
const EMPTY_FOLDERS: LibraryFolder[] = [];

/**
 * 보관함 목록·폴더 트리 쿼리. 변환 중 문서나 업로드 대기가 있으면 1.5초, 아니면 idle 주기(6초)로 다시 읽는다.
 * 낙관적 반영(업로드·삭제·이동 직후)은 setDocuments/setFolders로 캐시에 직접 쓴다.
 */
export function useLibraryData(filters: LibraryFilters, pendingUploadCount: number) {
  const queryClient = useQueryClient();
  const { folder, query, status } = filters;
  const documentsKey = useMemo(() => libraryKeys.documents({ folder, query, status }), [folder, query, status]);

  const documentsQuery = useQuery({
    queryKey: documentsKey,
    queryFn: ({ signal }) => fetchLibraryDocuments({ folder, query, status }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: (current) => libraryPollInterval(current.state.data ?? EMPTY_DOCUMENTS, pendingUploadCount)
  });
  const documents = documentsQuery.data ?? EMPTY_DOCUMENTS;
  const pollInterval = libraryPollInterval(documents, pendingUploadCount);

  const foldersQuery = useQuery({
    queryKey: libraryKeys.tree(),
    queryFn: ({ signal }) => fetchLibraryFolders(signal),
    refetchInterval: pollInterval
  });
  const folders = foldersQuery.data ?? EMPTY_FOLDERS;

  const setDocuments = useCallback(
    (updater: (current: LibraryDocument[]) => LibraryDocument[]) => {
      queryClient.setQueryData<LibraryDocument[]>(documentsKey, (current) => updater(current ?? []));
    },
    [queryClient, documentsKey]
  );
  const setFolders = useCallback(
    (next: LibraryFolder[]) => queryClient.setQueryData<LibraryFolder[]>(libraryKeys.tree(), next),
    [queryClient]
  );
  /** 모든 목록·트리를 다시 읽는다(보이지 않는 필터 조합은 stale 표시만). */
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: libraryKeys.all }), [queryClient]);

  const rootFolder = useMemo(() => folders.find((folder) => folder.path === ""), [folders]);

  return {
    documents,
    folders,
    totalCount: rootFolder?.total_count ?? documents.length,
    /** 필터를 바꾼 뒤 첫 응답을 기다리는 중(폴링 중에는 false). */
    loading: documentsQuery.isPending || (documentsQuery.isFetching && documentsQuery.isPlaceholderData),
    error: documentsQuery.error ?? foldersQuery.error,
    errorUpdatedAt: Math.max(documentsQuery.errorUpdatedAt, foldersQuery.errorUpdatedAt),
    setDocuments,
    setFolders,
    refresh
  };
}
