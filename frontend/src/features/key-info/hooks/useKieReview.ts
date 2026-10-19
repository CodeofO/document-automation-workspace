// KIE 검수 상태: 현재 job·결과, 수정값(명시적 저장), 검수 체크, 필터, 감사 로그, export preset.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, jsonBody } from "../../../api/client";
import type { AuditEvent, ExportPreset } from "../../../api/types";
import { kieKeys, listAuditEvents, listExportPresets } from "../api";
import { extractionValuesFromResult, parseEditedValue } from "../model/schema";
import type { ExtractionJob, ExtractionResult, ExtractionValue, FieldDefinition, ReviewFilter, ValidatedOutput } from "../types";

export function useKieReview(schemaId: string | null) {
  const queryClient = useQueryClient();
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [edits, setEdits] = useState<Record<string, ExtractionValue>>({});
  const [editsResultId, setEditsResultId] = useState<string | null>(null);
  const [editedKeys, setEditedKeys] = useState<string[]>([]);
  const [reviewedFields, setReviewedFields] = useState<string[]>([]);
  const [savedReviewedFields, setSavedReviewedFields] = useState<string[]>([]);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");

  const presetsQuery = useQuery({
    queryKey: kieKeys.exportPresets(schemaId ?? ""),
    queryFn: () => listExportPresets(schemaId!),
    enabled: Boolean(schemaId)
  });

  const result = job?.result ?? null;
  const resultValues = extractionValuesFromResult(result);
  const values = result && editsResultId === result.id && Object.keys(edits).length ? edits : resultValues;
  const reviewedChanged =
    reviewedFields.length !== savedReviewedFields.length || reviewedFields.some((key) => !savedReviewedFields.includes(key));
  const dirty = Boolean(result) && (editedKeys.length > 0 || reviewedChanged);

  async function loadAudit(entityType: string, entityId: string) {
    try {
      setAuditEvents(await listAuditEvents(entityType, entityId));
    } catch {
      setAuditEvents([]);
    }
  }

  function applyResult(next: ExtractionResult) {
    setEdits(extractionValuesFromResult(next));
    setEditsResultId(next.id);
    setReviewedFields(next.reviewed_fields ?? []);
    setSavedReviewedFields(next.reviewed_fields ?? []);
    setEditedKeys([]);
    setFilter("all");
    void loadAudit("extraction_result", next.id);
  }

  function clear() {
    setEdits({});
    setEditsResultId(null);
    setEditedKeys([]);
    setReviewedFields([]);
    setSavedReviewedFields([]);
  }

  function reset() {
    setJob(null);
    clear();
    setAuditEvents([]);
    setFilter("all");
  }

  function updateEdit(key: string, rawValue: string, fields: FieldDefinition[]) {
    if (!result) return;
    const field = fields.find((item) => item.key_name === key);
    const parsed = parseEditedValue(rawValue, field?.output_format ?? "string");
    setEditsResultId(result.id);
    setEditedKeys((current) => (current.includes(key) ? current : [...current, key]));
    setEdits((current) => {
      const base = editsResultId === result.id && Object.keys(current).length ? current : resultValues;
      return { ...base, [key]: { ...base[key], value: parsed, normalized_value: parsed } };
    });
  }

  function toggleReviewed(key: string) {
    setReviewedFields((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  async function save() {
    if (!result) return;
    const correctedOutput: ValidatedOutput = { ...(result.corrected_output ?? result.validated_output), values };
    const updated = await api<ExtractionResult>(
      `/api/extraction-results/${result.id}`,
      jsonBody("PATCH", { corrected_output: correctedOutput, reviewed_fields: reviewedFields })
    );
    setJob((current) => (current ? { ...current, result: updated } : current));
    applyResult(updated);
  }

  async function savePreset(name: string, fields: FieldDefinition[]) {
    if (!schemaId) throw new Error("Export preset을 만들기 전에 schema를 저장하세요.");
    const preset = await api<ExportPreset>(
      "/api/export-presets",
      jsonBody("POST", {
        schema_id: schemaId,
        name,
        fields: fields.map((field) => ({ key_name: field.key_name, column_name: field.key_name, include: true }))
      })
    );
    queryClient.setQueryData<ExportPreset[]>(kieKeys.exportPresets(schemaId), (current) => [preset, ...(current ?? [])]);
    setSelectedPresetId(preset.id);
  }

  return {
    job,
    setJob,
    result,
    values,
    editedKeys,
    reviewedFields,
    filter,
    setFilter,
    auditEvents,
    setAuditEvents,
    loadAudit,
    exportPresets: presetsQuery.data ?? [],
    selectedPresetId,
    setSelectedPresetId,
    dirty,
    applyResult,
    clear,
    reset,
    updateEdit,
    toggleReviewed,
    save,
    savePreset
  };
}

export type KieReview = ReturnType<typeof useKieReview>;
