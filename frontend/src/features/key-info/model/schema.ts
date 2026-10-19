// Schema 편집·검증 규칙(순수 함수).
import { clamp01 } from "../../../lib/format";
import {
  OUTPUT_FORMATS,
  type ExtractionResult,
  type ExtractionValue,
  type FieldDefinition,
  type FieldRegion,
  type OutputFormat,
  type SavedSchema,
  type SchemaField,
  type SchemaRegion,
  type SchemaSaveStatus
} from "../types";

export const SAMPLE_SCHEMA_FIELDS: FieldDefinition[] = [
  {
    key_name: "문서번호",
    description: "문서 상단 근처의 문서번호, 영수증 번호, 신청 번호 또는 거래 번호입니다.",
    output_format: "string"
  },
  {
    key_name: "문서일자",
    description: "문서에 인쇄된 발급일, 제출일 또는 효력 발생일입니다.",
    output_format: "date"
  },
  {
    key_name: "발급기관",
    description: "문서를 발급한 기관, 은행, 업체 또는 권한 있는 조직입니다.",
    output_format: "string"
  },
  {
    key_name: "수신자",
    description: "문서의 수신자 또는 문서가 귀속되는 사람/조직입니다.",
    output_format: "string"
  },
  {
    key_name: "금액",
    description: "보이는 경우 최종 합계, 잔액 또는 거래 금액입니다.",
    output_format: "float"
  }
];

export const initialFields: SchemaField[] = [
  {
    local_id: "field_1",
    key_name: "",
    description: "",
    output_format: "string"
  }
];

export function extractionValuesFromResult(result: ExtractionResult | null | undefined): Record<string, ExtractionValue> {
  return result?.corrected_output?.values ?? result?.validated_output.values ?? {};
}

export function validateFields(fields: FieldDefinition[], regions: SchemaRegion[] = []) {
  if (!fields.length) return "Schema 필드를 최소 1개 이상 추가하세요.";
  const keys = fields.map((field) => field.key_name.trim());
  const regionIds = new Set(regions.map((region) => region.id));
  if (keys.some((key) => !key)) return "모든 필드에 필드명을 입력하세요.";
  if (fields.some((field) => !field.description.trim())) return "모든 필드에 설명을 입력하세요.";
  if (fields.some((field) => !OUTPUT_FORMATS.includes(field.output_format))) return "모든 필드의 출력 형식을 확인하세요.";
  if (fields.some((field) => field.region !== undefined && field.region !== null && !normalizeRegion(field.region))) {
    return "추출 영역은 page와 0~1 사이의 x, y, width, height 값을 사용해야 합니다.";
  }
  if (fields.some((field) => field.region_id && !regionIds.has(field.region_id))) return "필드에 연결된 영역은 저장된 추출 영역이어야 합니다.";
  if (new Set(keys).size !== keys.length) return "필드명은 중복될 수 없습니다.";
  if (new Set(regions.map((region) => region.id)).size !== regions.length) return "추출 영역 id는 중복될 수 없습니다.";
  return null;
}

export function hasMeaningfulSchema(fields: SchemaField[]) {
  return fields.some((field) => field.key_name.trim() || field.description.trim());
}

export function findSavedSchemaNameConflict(name: string, schemas: SavedSchema[], currentSchema: SavedSchema | null) {
  const normalized = name.trim();
  if (!normalized) return null;
  if (currentSchema && currentSchema.name.trim() === normalized) {
    return null;
  }
  return (
    schemas.find(
      (schema) =>
        !schema.ephemeral &&
        schema.id !== currentSchema?.id &&
        schema.name.trim() === normalized
    ) ?? null
  );
}

export function schemaSaveStatusLabel(
  status: SchemaSaveStatus,
  savedSchema: SavedSchema | null
) {
  if (status === "saving") return "자동 저장 중";
  if (status === "pending") return "자동 저장 대기";
  if (status === "saved") return savedSchema ? "자동 저장됨" : "준비됨";
  if (status === "error") return "자동 저장 차단";
  return savedSchema ? "자동 저장됨" : "초안";
}

export function schemaValidationHint(message: string | null) {
  if (!message) return null;
  const hints: Record<string, string> = {
    "Add at least one schema field.": "우측 schema에 최소 1개 이상의 필드를 추가하세요.",
    "Every field needs a key name.": "모든 필드에 필드명을 입력하세요.",
    "Every field needs a description.": "모든 필드에 설명을 입력하세요.",
    "Every field needs a supported output format.": "모든 필드의 출력 형식을 확인하세요.",
    "Extraction regions must use page plus x, y, width, height values between 0 and 1.": "Region 좌표는 0~1 사이 상대 좌표여야 합니다.",
    "Every field region must reference a saved extraction region.": "필드에 연결된 region이 저장된 region인지 확인하세요.",
    "Field key names must be unique.": "필드명은 중복될 수 없습니다.",
    "Extraction region ids must be unique.": "Region id는 중복될 수 없습니다."
  };
  return hints[message] ?? message;
}

export function parseEditedValue(value: string, format: OutputFormat): unknown {
  if (value === "") return null;
  if (format === "float") {
    const parsed = Number.parseFloat(value.replace(/[,$€£₩¥\s]/g, ""));
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (format === "bool") {
    if (["true", "yes", "y", "1", "예", "네", "동의"].includes(value.toLowerCase())) return true;
    if (["false", "no", "n", "0", "아니오", "아니요", "미동의"].includes(value.toLowerCase())) return false;
  }
  return value;
}

export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function stripLocalId(field: SchemaField): FieldDefinition {
  const payload: FieldDefinition = {
    key_name: field.key_name,
    description: field.description,
    output_format: field.output_format,
    judgement_enabled: Boolean(field.judgement_enabled)
  };
  if (field.region_id) payload.region_id = field.region_id;
  return payload;
}

export function toSchemaFields(items: FieldDefinition[]): SchemaField[] {
  return items.map((field, index) => ({
    ...field,
    region_id: field.region_id ?? null,
    region: null,
    judgement_enabled: Boolean(field.judgement_enabled),
    local_id: `${createLocalId()}_${index}`
  }));
}

export function normalizeSchemaFieldsAndRegions(
  fields: FieldDefinition[],
  schemaRegions: SchemaRegion[]
): { fields: FieldDefinition[]; regions: SchemaRegion[] } {
  const regions = schemaRegions.map(normalizeSchemaRegion).filter(Boolean) as SchemaRegion[];
  const regionIds = new Set(regions.map((region) => region.id));
  const nextFields: FieldDefinition[] = [];

  fields.forEach((field) => {
    let regionId = field.region_id && regionIds.has(field.region_id) ? field.region_id : null;
    const legacyRegion = normalizeRegion(field.region);
    if (!regionId && legacyRegion) {
      const generatedId = createRegionId(regions);
      regions.push({
        ...legacyRegion,
        id: generatedId,
        name: `영역 ${regions.length + 1}`
      });
      regionIds.add(generatedId);
      regionId = generatedId;
    }
    nextFields.push({
      key_name: field.key_name,
      description: field.description,
      output_format: field.output_format,
      region_id: regionId,
      judgement_enabled: Boolean(field.judgement_enabled)
    });
  });

  return { fields: nextFields, regions };
}

export function normalizeSchemaRegion(value: unknown): SchemaRegion | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SchemaRegion>;
  const region = normalizeRegion(record);
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!region || !id || !name) return null;
  return { ...region, id, name };
}

export function normalizeRegion(value: unknown): FieldRegion | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<FieldRegion>;
  const page = Number(record.page);
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (![page, x, y, width, height].every(Number.isFinite)) return null;
  if (page < 1 || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null;
  return roundRegion({ page: Math.floor(page), x, y, width, height });
}

export function roundRegion(region: FieldRegion): FieldRegion {
  const x = Math.min(0.99, clamp01(region.x));
  const y = Math.min(0.99, clamp01(region.y));
  return {
    page: Math.max(1, Math.floor(region.page)),
    x: roundCoordinate(x),
    y: roundCoordinate(y),
    width: roundCoordinate(Math.min(1 - x, Math.max(0.01, region.width))),
    height: roundCoordinate(Math.min(1 - y, Math.max(0.01, region.height)))
  };
}

export function roundCoordinate(value: number): number {
  return Number(value.toFixed(4));
}

export function formatRegionNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : value.toFixed(3);
}

export function createLocalId(): string {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `field_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function createRegionId(regions: SchemaRegion[]): string {
  const used = new Set(regions.map((region) => region.id));
  let index = regions.length + 1;
  while (used.has(`region_${index}`)) index += 1;
  return `region_${index}`;
}
