import { apiClient, apiUrl, unwrap } from "../../api/client";
import type { RawExtraction } from "../../api/types";
import { createStoredValue } from "../../lib/storage";

export type RawExtractionOptions = {
  includeImages: boolean;
  includeFormulas: boolean;
};

export const rawKeys = {
  recent: ["raw-extractions", "recent"] as const
};

export async function listRecentRawExtractions(): Promise<RawExtraction[]> {
  return unwrap(await apiClient.GET("/api/raw-extractions", { params: { query: { limit: 12 } } }));
}

export async function getRawExtraction(rawId: string): Promise<RawExtraction> {
  return unwrap(await apiClient.GET("/api/raw-extractions/{raw_id}", { params: { path: { raw_id: rawId } } }));
}

export async function createRawExtractionFromDocument(documentId: string, options: RawExtractionOptions) {
  return unwrap(
    await apiClient.POST("/api/raw-extractions/from-document", {
      body: {
        document_id: documentId,
        include_images: options.includeImages,
        include_formulas: options.includeFormulas
      }
    })
  );
}

export function rawAssetUrl(path: string | null | undefined): string | null {
  return path ? apiUrl(path) : null;
}

/** 마지막으로 연 원문 추출 결과(다시 들어오면 복원). */
export const lastRawExtraction = createStoredValue<{ raw_id: string } | null>({
  key: "digitize_raw_extraction_state_v1",
  parse: (raw) =>
    raw && typeof raw === "object" && typeof (raw as { raw_id?: unknown }).raw_id === "string"
      ? { raw_id: (raw as { raw_id: string }).raw_id }
      : null,
  fallback: null
});
