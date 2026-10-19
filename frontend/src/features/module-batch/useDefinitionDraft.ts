// 정의(분류기·체크리스트) 목록 query + 편집 중인 초안 상태 + 자동 저장/복제/삭제.
// 저장 방식은 KIE schema와 같다: 편집 후 0.9초 뒤 자동 저장(spec B-5). 입력이 덜 됐으면 저장 대기.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toFriendlyError } from "../../api/client";
import type { SaveState } from "../../components/ui";
import {
  deleteDefinition,
  duplicateDefinition,
  removeDefinitionCache,
  saveDefinition,
  useModuleDefinitions,
  writeDefinitionCache
} from "./api";
import type { DraftState, ModuleDefinition, ModuleKindConfig } from "./types";

export const DEFINITION_AUTOSAVE_MS = 900;

export function useDefinitionDraft<TDef extends ModuleDefinition, TDraft extends ModuleDefinition, TOutput>(
  config: ModuleKindConfig<TDef, TDraft, TOutput>
) {
  const queryClient = useQueryClient();
  const definitionsQuery = useModuleDefinitions<TDef>(config);
  const definitions = useMemo(() => definitionsQuery.data ?? [], [definitionsQuery.data]);
  // null이면 아직 사용자가 고르지 않았다: 목록의 첫 정의(없으면 기본 초안)를 보여준다.
  const [chosen, setChosen] = useState<DraftState<TDraft> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const firstDefinition = definitions[0];
  const fallback = useMemo<DraftState<TDraft>>(
    () =>
      firstDefinition
        ? { configId: firstDefinition.id, draft: config.toDraft(firstDefinition), dirty: false }
        : { configId: null, draft: config.defaultDraft(), dirty: false },
    [config, firstDefinition]
  );
  const current = chosen ?? fallback;

  /** 저장 바디를 만들 수 없으면 그 이유(자동 저장 대기 사유). */
  const validationMessage = useMemo(() => {
    try {
      config.toPayload(current.draft);
      return null;
    } catch (error) {
      return toFriendlyError(error);
    }
  }, [config, current.draft]);

  const setDraft = (draft: TDraft) => {
    setSaveError(null);
    setChosen({ configId: current.configId, draft, dirty: true });
  };
  const load = (definition: TDef) => {
    setSaveError(null);
    setChosen({ configId: definition.id, draft: config.toDraft(definition), dirty: false });
  };
  const startNew = () => setChosen({ configId: null, draft: config.defaultDraft(), dirty: false });
  const replaceDraft = (draft: TDraft) => setChosen({ configId: null, draft, dirty: true });

  /**
   * 현재 초안을 저장(새로 만들거나 수정)하고 id를 돌려준다.
   * 저장하는 동안 사용자가 더 고쳤으면 그 수정은 남겨 두고 id만 반영한다.
   */
  async function save(): Promise<string> {
    const snapshot = current;
    const payload = config.toPayload(snapshot.draft);
    setSaving(true);
    try {
      const saved = await saveDefinition<TDef>(config, snapshot.configId, payload);
      writeDefinitionCache(queryClient, config.kind, saved);
      setSaveError(null);
      setChosen((previous) => {
        const base = previous ?? snapshot;
        return base.draft === snapshot.draft
          ? { configId: saved.id, draft: config.toDraft(saved), dirty: false }
          : { ...base, configId: saved.id };
      });
      return saved.id;
    } catch (error) {
      setSaveError(toFriendlyError(error));
      throw error;
    } finally {
      setSaving(false);
    }
  }

  // 자동 저장: 편집이 멈추고 0.9초 뒤. 저장 바디를 만들 수 없으면(이름 없음 등) 기다린다.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const autosaveReady = current.dirty && !validationMessage;
  useEffect(() => {
    if (!autosaveReady) return;
    const timer = window.setTimeout(() => {
      saveRef.current().catch(() => undefined);
    }, DEFINITION_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [autosaveReady, current.draft]);

  async function duplicate(id: string): Promise<TDef> {
    const duplicated = await duplicateDefinition<TDef>(config, id);
    writeDefinitionCache(queryClient, config.kind, duplicated);
    load(duplicated);
    return duplicated;
  }

  /** 삭제한다. 편집 중인 정의였으면 true(호출자가 새 초안을 연다). */
  async function remove(id: string): Promise<boolean> {
    await deleteDefinition(config, id);
    removeDefinitionCache<TDef>(queryClient, config.kind, id);
    return current.configId === id;
  }

  const saveState: SaveState = saving
    ? "saving"
    : saveError
      ? "error"
      : current.dirty
        ? "pending"
        : current.configId
          ? "saved"
          : "idle";

  return {
    definitions,
    loadError: definitionsQuery.data ? null : definitionsQuery.error,
    activeConfigId: current.configId,
    draft: current.draft,
    dirty: current.dirty,
    saveState,
    saveMessage: saveError ?? (current.dirty ? validationMessage : null),
    setDraft,
    load,
    startNew,
    replaceDraft,
    save,
    duplicate,
    remove
  };
}
