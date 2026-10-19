// 생성된 OpenAPI 타입(schema.d.ts)의 별칭과, 여러 기능이 같이 쓰는 뷰 모델 타입.
import type { Schemas } from "./client";

export type SystemStatus = Schemas["SystemStatusRead"];
export type VlmSettings = Schemas["VlmSettingsRead"];
export type VlmSettingsUpdate = Schemas["VlmSettingsUpdate"];
export type RawExtraction = Schemas["RawExtractionRead"];
export type AuditEvent = Schemas["AuditEventRead"];
export type ArchiveSearchResult = Schemas["ArchiveSearchResult"];
export type ExportPreset = Schemas["ExportPresetRead"];
export type DocumentRead = Schemas["DocumentRead"];
export type DocumentPageRead = Schemas["DocumentPageRead"];

/**
 * 보관함 문서 목록 항목. DocumentRead에서 pages를 뺀 모양이다.
 */
export type LibraryDocument = {
  document_id: string;
  filename: string;
  library_path: string | null;
  mime_type: string;
  size_bytes: number;
  page_count: number;
  status: string;
  error_message?: string | null;
  created_at: string;
  deleted_at?: string | null;
};
