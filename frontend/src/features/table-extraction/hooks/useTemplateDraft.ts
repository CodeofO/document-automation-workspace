// 표 양식 편집 초안 + 자동 저장(KIE schema·분류기와 같은 규칙: 편집이 멈추고 0.9초 뒤, 입력이 덜 됐으면 대기).
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toFriendlyError } from "../../../api/client";
import type { SaveState } from "../../../components/ui";
import { createTableTemplate, updateTableTemplate, writeTemplateCache } from "../api";
import { draftToPayload, templateDraftError, templateToDraft, type TemplateDraft } from "../model/template";
import type { TableTemplate } from "../types";

export const TEMPLATE_AUTOSAVE_MS = 900;

type DraftState = { templateId: string | null; draft: TemplateDraft; dirty: boolean };

export function useTemplateDraft(options: {
  /** 불러온 양식(없으면 새 초안) */
  template: TableTemplate | null;
  newDraft: () => TemplateDraft;
  /** 새 양식이 처음 저장됐을 때(주소를 /tables/templates/:id로 바꾸는 데 쓴다) */
  onCreated?: (template: TableTemplate) => void;
}) {
  const queryClient = useQueryClient();
  const loadedId = options.template?.id ?? null;
  const [state, setState] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  // 불러온 양식이 바뀌면(다른 양식을 열면) 그 양식으로 초안을 바꾼다. 같은 양식이면 편집 중인 초안을 유지한다.
  const fallback = useMemo<DraftState>(
    () =>
      options.template
        ? { templateId: options.template.id, draft: templateToDraft(options.template), dirty: false }
        : { templateId: null, draft: options.newDraft(), dirty: false },
    // newDraft는 새 초안을 만들 때만 필요하다(목록이 갱신될 때마다 초안을 바꾸지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadedId]
  );
  const current =
    state && (state.templateId === loadedId || (state.templateId !== null && loadedId === null)) ? state : fallback;

  const validationMessage = useMemo(() => templateDraftError(current.draft), [current.draft]);

  function setDraft(draft: TemplateDraft) {
    setSaveError(null);
    setState({ templateId: current.templateId, draft, dirty: true });
  }

  function update(updater: (draft: TemplateDraft) => TemplateDraft) {
    setDraft(updater(current.draft));
  }

  async function save(): Promise<TableTemplate> {
    const snapshot = current;
    const error = templateDraftError(snapshot.draft);
    if (error) throw new Error(error);
    const payload = draftToPayload(snapshot.draft);
    setSaving(true);
    try {
      const saved = snapshot.templateId
        ? await updateTableTemplate(snapshot.templateId, payload)
        : await createTableTemplate(payload);
      writeTemplateCache(queryClient, saved);
      setSaveError(null);
      setSavedVersion(saved.current_version);
      setState((previous) => {
        const base = previous ?? snapshot;
        // 저장하는 동안 더 고쳤으면 그 수정은 남기고 id만 반영한다.
        return base.draft === snapshot.draft
          ? { templateId: saved.id, draft: base.draft, dirty: false }
          : { ...base, templateId: saved.id };
      });
      if (!snapshot.templateId) options.onCreated?.(saved);
      return saved;
    } catch (exc) {
      setSaveError(toFriendlyError(exc));
      throw exc;
    } finally {
      setSaving(false);
    }
  }

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const autosaveReady = current.dirty && !validationMessage && !saving;
  useEffect(() => {
    if (!autosaveReady) return;
    const timer = window.setTimeout(() => {
      saveRef.current().catch(() => undefined);
    }, TEMPLATE_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [autosaveReady, current.draft]);

  /** 저장되지 않은 변경이 있으면 지금 저장하고 id를 돌려준다(실행·미리보기 전에 부른다). */
  async function flush(): Promise<string | null> {
    if (current.dirty || !current.templateId) return (await save()).id;
    return current.templateId;
  }

  const saveState: SaveState = saving
    ? "saving"
    : saveError
      ? "error"
      : current.dirty
        ? "pending"
        : current.templateId
          ? "saved"
          : "idle";

  return {
    templateId: current.templateId,
    draft: current.draft,
    dirty: current.dirty,
    saveState,
    saveMessage: saveError ?? (current.dirty ? validationMessage : null),
    validationMessage,
    savedVersion: savedVersion ?? options.template?.current_version ?? null,
    setDraft,
    update,
    save,
    flush,
    reset: () => setState(null)
  };
}
