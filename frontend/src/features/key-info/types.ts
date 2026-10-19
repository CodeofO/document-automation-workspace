// 핵심 정보 추출(KIE) 뷰 모델 타입. API 응답 모양은 schema.d.ts의 SchemaRead/ExtractionJobRead/BatchRead와 같다.

export type SchemaSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export const OUTPUT_FORMATS = ["string", "float", "date", "bool"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export type Step = "upload" | "schema" | "review";

export type ReviewFilter = "needs_review" | "all" | "warning" | "null" | "changed" | "low_confidence" | "unreviewed" | "ai_corrected" | "ai_review_failed";


export type FieldRegion = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SchemaRegion = FieldRegion & {
  id: string;
  name: string;
};

export type DocumentPage = {
  id: string;
  page: number;
  image_url: string;
  width: number;
  height: number;
};

export type RegionEditorPage = {
  id: string;
  page: number;
  image_url: string;
};

export type RegionEditorTarget = {
  page_count: number;
  pages: RegionEditorPage[];
};

export type UploadedDocument = {
  document_id: string;
  filename: string;
  library_path: string | null;
  mime_type: string;
  size_bytes: number;
  page_count: number;
  status: string;
  error_message?: string | null;
  document_type: string | null;
  language: string | null;
  ai_summary: string | null;
  recommendation_reasoning: string | null;
  pages: DocumentPage[];
  created_at: string;
  deleted_at?: string | null;
};

export type FieldDefinition = {
  key_name: string;
  description: string;
  output_format: OutputFormat;
  region_id?: string | null;
  region?: FieldRegion | null;
  judgement_enabled?: boolean;
};

export type SchemaField = FieldDefinition & {
  local_id: string;
};

export type SavedSchema = {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  is_template: boolean;
  template_category: string | null;
  pinned: boolean;
  ephemeral: boolean;
  archived: boolean;
  regions: SchemaRegion[];
  fields: FieldDefinition[];
  created_at: string;
  updated_at: string;
};

export type SchemaRecommendation = {
  name: string;
  display_name: string | null;
  description: string | null;
  document_type: string | null;
  language: string | null;
  reasoning: string | null;
  fields: FieldDefinition[];
};

export type SchemaDescriptionRecommendation = {
  description: string;
  reasoning: string | null;
};

export type ExtractionValue = {
  value: unknown;
  normalized_value: unknown;
  page: number | null;
  confidence: number | null;
  evidence: string | null;
  warnings: string[];
  ai_review?: {
    enabled?: boolean;
    mode?: "full_page" | "region" | string;
    judgement_status?: "correct" | "needs_correction" | "failed" | string;
    judgement_reason?: string | null;
    judgement_confidence?: number | null;
    initial_value?: unknown;
    initial_evidence?: string | null;
    corrected?: boolean;
    correction_reason?: string | null;
  };
};

export type ValidatedOutput = {
  document_id: string;
  schema_id: string;
  status: string;
  values: Record<string, ExtractionValue>;
};

export type ExtractionResult = {
  id: string;
  job_id: string;
  raw_model_output: Record<string, unknown>;
  validated_output: ValidatedOutput;
  corrected_output: ValidatedOutput | null;
  validation_warnings: string[];
  reviewed_fields: string[];
  created_at: string;
  updated_at: string;
};

export type ExtractionJob = {
  job_id: string;
  document_id: string;
  schema_id: string;
  status: string;
  error_message: string | null;
  result_id: string | null;
  result: ExtractionResult | null;
  /** 페이지 단위 job이면 그 페이지(없거나 null이면 문서 전체). */
  page_number?: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type BatchItem = {
  id: string;
  document_id: string;
  job_id: string;
  filename: string;
  /** 페이지 단위 처리(백엔드 예정). 없거나 null이면 문서 전체. */
  page_number?: number | null;
  status: string;
  result_id: string | null;
  error_message: string | null;
  created_at: string;
};

export type Batch = {
  id: string;
  schema_id: string;
  status: string;
  total_count: number;
  completed_count: number;
  failed_count: number;
  canceled_count: number;
  uploaded_count?: number;
  preprocessing_count?: number;
  ready_count?: number;
  queued_count?: number;
  running_count?: number;
  needs_review_count?: number;
  progress_phase?: string;
  progress: number;
  items: BatchItem[];
  created_at: string;
  completed_at: string | null;
};
