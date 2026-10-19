// Schema 초안 편집·검증·자동 저장(0.9초)·목록 작업(불러오기·복제·삭제·템플릿·JSON 가져오기).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, jsonBody, toFriendlyError } from "../../../api/client";
import type { SaveState } from "../../../components/ui";
import { getSchema, kieKeys, listSchemas } from "../api";
import {
  SAMPLE_SCHEMA_FIELDS,
  createLocalId,
  findSavedSchemaNameConflict,
  hasMeaningfulSchema,
  initialFields,
  normalizeRegion,
  normalizeSchemaFieldsAndRegions,
  normalizeSchemaRegion,
  schemaValidationHint,
  stripLocalId,
  toSchemaFields,
  validateFields
} from "../model/schema";
import type {
  FieldDefinition,
  OutputFormat,
  SavedSchema,
  SchemaDescriptionRecommendation,
  SchemaField,
  SchemaRecommendation,
  SchemaRegion
} from "../types";

export const SCHEMA_AUTOSAVE_MS = 900;

export function useSchemaDraft(options: { enabled: boolean; onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [schemaName, setSchemaName] = useState("document_schema");
  const [schemaDescription, setSchemaDescription] = useState("");
  const [fields, setFields] = useState<SchemaField[]>(initialFields);
  const [regions, setRegions] = useState<SchemaRegion[]>([]);
  const [schema, setSchema] = useState<SavedSchema | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [jsonInput, setJsonInput] = useState("");
  const [regionsVisible, setRegionsVisible] = useState(false);
  const cacheRef = useRef<Map<string, SavedSchema>>(new Map());

  const schemasQuery = useQuery({ queryKey: kieKeys.schemas, queryFn: listSchemas });
  const savedSchemas = useMemo(() => schemasQuery.data ?? [], [schemasQuery.data]);
  const templates = savedSchemas.filter((item) => item.is_template || item.pinned);

  const payloadFields = useMemo(() => fields.map(stripLocalId), [fields]);
  const payloadRegions = useMemo(() => regions.map(normalizeSchemaRegion).filter(Boolean) as SchemaRegion[], [regions]);
  const assignedRegions = useMemo(() => {
    const assigned = new Set(payloadFields.map((field) => field.region_id).filter(Boolean));
    return payloadRegions.filter((region) => assigned.has(region.id));
  }, [payloadFields, payloadRegions]);
  const preview = useMemo(
    () =>
      JSON.stringify(
        {
          name: schemaName,
          display_name: schemaName,
          description: schemaDescription || null,
          regions: payloadRegions,
          fields: payloadFields
        },
        null,
        2
      ),
    [schemaName, schemaDescription, payloadFields, payloadRegions]
  );
  const previewRef = useRef(preview);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  const downloadUrl = useMemo(() => `data:application/json;charset=utf-8,${encodeURIComponent(preview)}`, [preview]);
  const nameConflict = useMemo(
    () => findSavedSchemaNameConflict(schemaName, savedSchemas, schema?.ephemeral ? null : schema),
    [schemaName, savedSchemas, schema]
  );
  const validationError = useMemo(() => validateFields(payloadFields, payloadRegions), [payloadFields, payloadRegions]);

  /** 자동 저장을 막는 이유(없으면 null). */
  const blockReason = !schemaName.trim()
    ? "Schema 이름을 입력하면 자동 저장됩니다."
    : validationError
      ? schemaValidationHint(validationError)
      : nameConflict
        ? `이미 저장된 schema 이름입니다: ${nameConflict.display_name || nameConflict.name}`
        : null;
  const saveState: SaveState = saving
    ? "saving"
    : saveError
      ? "error"
      : dirty
        ? nameConflict
          ? "error"
          : "pending"
        : schema
          ? "saved"
          : "idle";
  const saveMessage = saveError ?? (dirty ? blockReason : null);

  const markDirty = () => {
    setDirty(true);
    setSaveError(null);
  };

  async function refreshList() {
    await queryClient.invalidateQueries({ queryKey: kieKeys.schemas });
  }

  /** 저장(새로 만들거나 수정). 실패하면 null. silent면 오류를 화면 상단에 띄우지 않는다. */
  async function persist(persistOptions: { silent: boolean }): Promise<SavedSchema | null> {
    const draftKey = previewRef.current;
    if (validationError) {
      if (!persistOptions.silent) options.onError(validationError);
      return null;
    }
    if (nameConflict) {
      const message = `이미 저장된 schema 이름입니다: ${nameConflict.display_name || nameConflict.name}. 목록에서 불러오거나 다른 이름으로 저장하세요.`;
      if (!persistOptions.silent) options.onError(message);
      setSaveError(message);
      return null;
    }
    setSaving(true);
    try {
      const saved = await api<SavedSchema>(
        schema ? `/api/schemas/${schema.id}` : "/api/schemas",
        jsonBody(schema ? "PATCH" : "POST", {
          name: schemaName,
          display_name: schemaName,
          description: schemaDescription || null,
          regions: payloadRegions,
          fields: payloadFields
        })
      );
      setSchema(saved);
      cacheRef.current.set(saved.id, saved);
      // 저장하는 동안 더 고쳤으면 dirty를 남겨 다음 자동 저장이 이어서 저장한다.
      if (previewRef.current === draftKey) setDirty(false);
      setSaveError(null);
      await refreshList();
      return saved;
    } catch (error) {
      const message = toFriendlyError(error);
      setSaveError(message);
      if (!persistOptions.silent) options.onError(message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  // ---- 자동 저장 ----
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  });
  const autosaveReady = options.enabled && dirty && !blockReason && !saving;
  useEffect(() => {
    if (!autosaveReady) return;
    const timer = window.setTimeout(() => void persistRef.current({ silent: true }), SCHEMA_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [autosaveReady, preview]);

  // ---- 상태 바꾸기 ----

  function apply(next: SavedSchema) {
    const normalized = normalizeSchemaFieldsAndRegions(next.fields, next.regions ?? []);
    cacheRef.current.set(next.id, next);
    setSchema(next.ephemeral ? null : next);
    setSchemaName(next.name);
    setSchemaDescription(next.description ?? "");
    setRegions(normalized.regions);
    if (normalized.regions.length) setRegionsVisible(true);
    setFields(toSchemaFields(normalized.fields));
    setDirty(false);
    setSaveError(null);
  }

  function applyRecommendation(recommendation: SchemaRecommendation) {
    setSchema(null);
    setSchemaName(recommendation.name || "ai_recommended_schema");
    setSchemaDescription(recommendation.description ?? "");
    setFields(toSchemaFields(recommendation.fields));
    setRegions([]);
    markDirty();
  }

  function startNew() {
    setSchema(null);
    setSchemaName("document_schema");
    setSchemaDescription("");
    setRegions([]);
    setFields(initialFields.map((field) => ({ ...field, local_id: createLocalId() })));
    markDirty();
  }

  function applySample() {
    setSchema(null);
    setSchemaName("sample_document_schema");
    setSchemaDescription("일반 업무 문서에 바로 쓸 수 있는 시작용 schema입니다.");
    setRegions([]);
    setFields(toSchemaFields(SAMPLE_SCHEMA_FIELDS));
    markDirty();
  }

  function loadTemplate(template: SavedSchema) {
    apply(template);
    setSchema(null);
    markDirty();
  }

  /** JSON 붙여넣기 → 초안. 실패하면 오류 문구. */
  function importJson(): string | null {
    try {
      const parsed = JSON.parse(jsonInput) as Partial<SchemaRecommendation> & { regions?: unknown[] };
      if (!parsed.name || !Array.isArray(parsed.fields)) return "Schema JSON에는 name과 fields가 필요합니다.";
      const fieldsFromJson = parsed.fields.map((field) => ({
        key_name: String(field.key_name ?? "").trim(),
        description: String(field.description ?? "").trim(),
        output_format: field.output_format as OutputFormat,
        region_id: typeof field.region_id === "string" ? field.region_id.trim() || null : null,
        region: normalizeRegion(field.region),
        judgement_enabled: Boolean(field.judgement_enabled)
      }));
      const regionsFromJson = Array.isArray(parsed.regions)
        ? (parsed.regions.map(normalizeSchemaRegion).filter(Boolean) as SchemaRegion[])
        : [];
      const normalized = normalizeSchemaFieldsAndRegions(fieldsFromJson, regionsFromJson);
      const error = validateFields(normalized.fields, normalized.regions);
      if (error) return error;
      setSchema(null);
      setSchemaName(parsed.name);
      setSchemaDescription(parsed.description ?? "");
      setRegions(normalized.regions);
      if (normalized.regions.length) setRegionsVisible(true);
      setFields(toSchemaFields(normalized.fields));
      markDirty();
      return null;
    } catch {
      return "Schema JSON을 해석할 수 없습니다.";
    }
  }

  function updateField(index: number, patch: Partial<FieldDefinition>) {
    markDirty();
    setFields((current) => current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)));
  }

  function addField() {
    markDirty();
    setFields((current) => [
      ...current,
      { local_id: createLocalId(), key_name: `field_${current.length + 1}`, description: "", output_format: "string" }
    ]);
  }

  function removeField(index: number) {
    markDirty();
    setFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index));
  }

  /** 영역을 저장하고, fieldIndex가 있으면 그 필드에 붙인다. */
  function saveRegion(region: SchemaRegion, fieldIndex: number | null = null) {
    const normalized = normalizeSchemaRegion(region);
    if (!normalized) return;
    markDirty();
    setRegionsVisible(true);
    setRegions((current) =>
      current.some((item) => item.id === normalized.id)
        ? current.map((item) => (item.id === normalized.id ? normalized : item))
        : [...current, normalized]
    );
    if (fieldIndex !== null) {
      setFields((current) =>
        current.map((field, index) => (index === fieldIndex ? { ...field, region_id: normalized.id, region: null } : field))
      );
    }
  }

  function removeRegion(regionId: string) {
    markDirty();
    setRegions((current) => current.filter((region) => region.id !== regionId));
    setFields((current) => current.map((field) => (field.region_id === regionId ? { ...field, region_id: null } : field)));
  }

  async function getCached(schemaId: string, getOptions: { force?: boolean; signal?: AbortSignal } = {}) {
    const cached = cacheRef.current.get(schemaId);
    if (cached && !getOptions.force) return cached;
    const loaded = await getSchema(schemaId, getOptions.signal);
    cacheRef.current.set(schemaId, loaded);
    return loaded;
  }

  async function remove(schemaId: string) {
    await api<SavedSchema>(`/api/schemas/${schemaId}`, { method: "DELETE" });
    cacheRef.current.delete(schemaId);
    queryClient.setQueryData<SavedSchema[]>(kieKeys.schemas, (current) => (current ?? []).filter((item) => item.id !== schemaId));
    if (schema?.id === schemaId) startNew();
    await refreshList();
  }

  async function duplicate(schemaId: string) {
    const duplicated = await api<SavedSchema>(`/api/schemas/${schemaId}/duplicate`, { method: "POST" });
    cacheRef.current.set(duplicated.id, duplicated);
    queryClient.setQueryData<SavedSchema[]>(kieKeys.schemas, (current) => [
      duplicated,
      ...(current ?? []).filter((item) => item.id !== duplicated.id)
    ]);
    apply(duplicated);
    await refreshList();
  }

  async function markAsTemplate(category = "일반") {
    if (!schema) throw new Error("템플릿으로 추가하기 전에 schema를 저장하세요.");
    const updated = await api<SavedSchema>(
      `/api/schemas/${schema.id}`,
      jsonBody("PATCH", { is_template: true, template_category: category, pinned: true })
    );
    apply(updated);
    await refreshList();
  }

  async function recommendDescription(documentId: string | null) {
    if (validationError) throw new Error(validationError);
    const recommendation = await api<SchemaDescriptionRecommendation>(
      "/api/schemas/description-recommendations",
      jsonBody("POST", {
        document_id: documentId,
        name: schemaName.trim() || "draft_schema",
        current_description: schemaDescription || null,
        regions: payloadRegions,
        fields: payloadFields
      })
    );
    setSchemaDescription(recommendation.description);
    markDirty();
  }

  /** 추출에 쓸 schema: 저장된 그대로면 저장본, 아니면 초안 바디. */
  function extractionSource(): { schemaId: string } | { draft: Record<string, unknown> } {
    if (schema && !dirty && !schema.ephemeral) return { schemaId: schema.id };
    return {
      draft: {
        name: schemaName.trim() || "draft_schema",
        display_name: schemaName.trim() || "draft_schema",
        description: schemaDescription || null,
        regions: payloadRegions,
        fields: payloadFields
      }
    };
  }

  return {
    schemaName,
    schemaDescription,
    fields,
    regions,
    schema,
    dirty,
    saveState,
    saveMessage,
    savedSchemas,
    templates,
    payloadFields,
    payloadRegions,
    assignedRegions,
    regionsVisible,
    setRegionsVisible,
    preview,
    downloadUrl,
    jsonInput,
    setJsonInput,
    nameConflict,
    validationError,
    ready: Boolean(schemaName.trim()) && !validationError && !nameConflict,
    meaningful: dirty || Boolean(schema) || hasMeaningfulSchema(fields),
    setName: (value: string) => {
      setSchemaName(value);
      markDirty();
    },
    setDescription: (value: string) => {
      setSchemaDescription(value);
      markDirty();
    },
    apply,
    applyRecommendation,
    startNew,
    applySample,
    loadTemplate,
    importJson,
    updateField,
    addField,
    removeField,
    saveRegion,
    removeRegion,
    getCached,
    persist,
    remove,
    duplicate,
    markAsTemplate,
    recommendDescription,
    extractionSource,
    clearCache: () => cacheRef.current.clear()
  };
}

export type SchemaDraft = ReturnType<typeof useSchemaDraft>;
