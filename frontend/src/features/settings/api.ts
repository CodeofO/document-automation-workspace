import { useQuery } from "@tanstack/react-query";
import { api, apiClient, unwrap } from "../../api/client";
import type { SystemStatus, VlmSettings, VlmSettingsUpdate } from "../../api/types";

export const DEFAULT_UPLOAD_CHUNK_FILES = 10;
export const DEFAULT_MAX_BATCH_UPLOAD_FILES = 10000;

export const settingsKeys = {
  systemStatus: ["system", "status"] as const,
  vlm: ["settings", "vlm"] as const
};

export async function fetchSystemStatus(): Promise<SystemStatus> {
  return unwrap(await apiClient.GET("/api/system/status"));
}

export function useSystemStatus() {
  return useQuery({ queryKey: settingsKeys.systemStatus, queryFn: fetchSystemStatus, staleTime: 30_000, retry: 0 });
}

/** 업로드 한도(서버 설정). 상태를 아직 모르면 기본값. */
export function useUploadLimits() {
  const { data } = useSystemStatus();
  return {
    uploadMaxBatchFiles: data?.upload_max_batch_files ?? DEFAULT_MAX_BATCH_UPLOAD_FILES,
    uploadChunkFiles: data?.upload_chunk_files ?? DEFAULT_UPLOAD_CHUNK_FILES,
    systemStatus: data ?? null
  };
}

export function useVlmSettings(enabled = true) {
  return useQuery({
    queryKey: settingsKeys.vlm,
    queryFn: async (): Promise<VlmSettings> => unwrap(await apiClient.GET("/api/settings/vlm")),
    enabled,
    retry: 0
  });
}

export async function saveVlmSettings(body: VlmSettingsUpdate): Promise<VlmSettings> {
  return unwrap(await apiClient.PUT("/api/settings/vlm", { body }));
}

export type MaintenanceClearResponse = {
  status: string;
  counts: Record<string, number>;
  removed_paths: string[];
};

export async function clearParsingHistory(): Promise<MaintenanceClearResponse> {
  return api<MaintenanceClearResponse>("/api/maintenance/parsing-history", { method: "DELETE" });
}

/** 파싱 기록을 지운 뒤 열려 있는 화면이 자기 상태를 비우도록 알리는 이벤트. */
export const PARSING_HISTORY_CLEARED_EVENT = "digitize-parsing-history-cleared";
