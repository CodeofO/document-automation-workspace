import { useQueryClient } from "@tanstack/react-query";
import { Save, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toFriendlyError } from "../../api/client";
import type { VlmSettings } from "../../api/types";
import { Button, Dialog, InlineAlert, useConfirm, useToast } from "../../components/ui";
import {
  PARSING_HISTORY_CLEARED_EVENT,
  clearParsingHistory,
  saveVlmSettings,
  settingsKeys,
  useVlmSettings
} from "./api";

const DEFAULT_LIBREOFFICE_PATH = "/Applications/LibreOffice.app/Contents/MacOS/soffice";

type SettingsForm = {
  apiKey: string;
  modelName: string;
  baseUrl: string;
  libreOfficePath: string;
  reasoningEffort: string;
  verbosity: string;
  temperature: string;
  maxCompletionTokens: string;
  topP: string;
  serviceTier: string;
  workflowMaxWorkers: string;
  vlmMaxConcurrentRequests: string;
  vlmTimeoutSeconds: string;
  kieFieldGroupSize: string;
};

function formFromSettings(settings: VlmSettings | undefined): SettingsForm {
  return {
    apiKey: "",
    modelName: settings?.model_name ?? "",
    baseUrl: settings?.base_url ?? "",
    libreOfficePath: settings?.libreoffice_path ?? DEFAULT_LIBREOFFICE_PATH,
    reasoningEffort: settings?.inference_params?.reasoning_effort ?? settings?.reasoning_effort ?? "off",
    verbosity: settings?.inference_params?.verbosity ?? settings?.verbosity ?? "",
    temperature: settings?.inference_params?.temperature ?? settings?.temperature ?? "0",
    maxCompletionTokens: settings?.max_completion_tokens ?? "",
    topP: settings?.top_p ?? "",
    serviceTier: settings?.service_tier ?? "",
    workflowMaxWorkers: String(settings?.workflow_max_workers ?? 16),
    vlmMaxConcurrentRequests: String(settings?.vlm_max_concurrent_requests ?? 128),
    vlmTimeoutSeconds: String(settings?.vlm_timeout_seconds ?? 120),
    kieFieldGroupSize: String(settings?.kie_field_group_size ?? 2)
  };
}

function SettingsField(props: { label: string; help?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={props.wide ? "settings-field wide-field" : "settings-field"}>
      <span className="settings-field-label">{props.label}</span>
      {props.children}
      {props.help && <small className="settings-help">{props.help}</small>}
    </label>
  );
}

/** VLM·LibreOffice 설정과 파싱 기록 삭제. 상단바의 설정 버튼으로 연다. */
export function SettingsDialog(props: { open: boolean; onClose: () => void }) {
  const settingsQuery = useVlmSettings(props.open);
  if (!props.open) return null;
  // 설정을 불러온 뒤에 폼을 만든다(초기값이 서버 값이 되도록).
  if (settingsQuery.isPending) {
    return (
      <Dialog open title="API, 모델, LibreOffice" eyebrow="설정" closeLabel="설정 닫기" onClose={props.onClose}>
        <InlineAlert busy>설정을 불러오는 중입니다.</InlineAlert>
      </Dialog>
    );
  }
  return <SettingsDialogForm settings={settingsQuery.data ?? null} onClose={props.onClose} />;
}

function SettingsDialogForm(props: { settings: VlmSettings | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<SettingsForm>(() => formFromSettings(props.settings ?? undefined));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const settings = props.settings;
  const writable = settings?.runtime_settings_writable ?? true;

  const field = <K extends keyof SettingsForm>(key: K) => ({
    value: form[key],
    disabled: !writable,
    onChange: (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }))
  });

  async function save() {
    setBusy(".env 저장 중");
    setError(null);
    setMessage(null);
    try {
      const saved = await saveVlmSettings({
        api_key: form.apiKey,
        model_name: form.modelName,
        base_url: form.baseUrl,
        libreoffice_path: form.libreOfficePath,
        inference_params: {
          reasoning_effort: form.reasoningEffort,
          thinking: form.reasoningEffort,
          temperature: form.temperature,
          verbosity: form.verbosity,
          max_completion_tokens: form.maxCompletionTokens,
          top_p: form.topP,
          service_tier: form.serviceTier
        },
        workflow_max_workers: Number.parseInt(form.workflowMaxWorkers, 10) || 16,
        vlm_max_concurrent_requests: Number.parseInt(form.vlmMaxConcurrentRequests, 10) || 128,
        vlm_timeout_seconds: Number.parseInt(form.vlmTimeoutSeconds, 10) || 120,
        kie_field_group_size: Number.parseInt(form.kieFieldGroupSize, 10) || 2,
        provider: "auto"
      });
      queryClient.setQueryData(settingsKeys.vlm, saved);
      await queryClient.invalidateQueries({ queryKey: settingsKeys.systemStatus });
      toast.show(".env 저장 완료", { tone: "success" });
      props.onClose();
    } catch (err) {
      setError(toFriendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function clearHistory() {
    const confirmed = await confirm({
      title: "파싱 기록 삭제",
      message:
        "저장된 문서, 추출 job/result, batch, raw extraction 기록을 모두 삭제합니다. 저장된 schema는 유지됩니다. 계속할까요?",
      confirmLabel: "기록 비우기",
      tone: "danger"
    });
    if (!confirmed) return;
    setBusy("파싱 기록 삭제 중");
    setError(null);
    setMessage(null);
    try {
      const cleared = await clearParsingHistory();
      window.dispatchEvent(new Event(PARSING_HISTORY_CLEARED_EVENT));
      await queryClient.invalidateQueries();
      setMessage(
        `파싱 기록 삭제 완료: ${cleared.counts.documents ?? 0}개 문서, ${cleared.counts.extraction_jobs ?? 0}개 job`
      );
    } catch (err) {
      setError(toFriendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      title="API, 모델, LibreOffice"
      eyebrow="설정"
      closeLabel="설정 닫기"
      className="settings-panel"
      onClose={props.onClose}
    >
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {busy && <InlineAlert busy>{busy}</InlineAlert>}
      <div className="settings-grid">
        <SettingsField label="API key">
          <input
            type="password"
            placeholder={settings?.has_api_key ? "저장된 key 유지" : "VLM_API_KEY"}
            autoComplete="off"
            {...field("apiKey")}
          />
        </SettingsField>
        <SettingsField label="Model name">
          <input placeholder="gpt-4.1-mini 또는 로컬 모델명" {...field("modelName")} />
        </SettingsField>
        <SettingsField
          label="Base URL"
          wide
          help="로컬 VLM이나 사설 OpenAI-compatible 서버를 사용할 때 입력합니다. 예: http://127.0.0.1:11434/v1"
        >
          <input placeholder="비워두면 기본 provider endpoint 사용" {...field("baseUrl")} />
        </SettingsField>
        <SettingsField label="LibreOffice path" wide>
          <input placeholder={DEFAULT_LIBREOFFICE_PATH} {...field("libreOfficePath")} />
        </SettingsField>
        <SettingsField
          label="Reasoning / thinking"
          help="기본값은 off입니다. Google은 thinking_budget=0으로, OpenAI/local compatible은 reasoning 파라미터를 보내지 않는 방식으로 처리합니다."
        >
          <select {...field("reasoningEffort")}>
            <option value="off">off</option>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </SettingsField>
        <SettingsField label="Verbosity">
          <select {...field("verbosity")}>
            <option value="">provider 기본값</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </SettingsField>
        <SettingsField label="Temperature">
          <input inputMode="decimal" placeholder="0" {...field("temperature")} />
        </SettingsField>
        <SettingsField label="Max tokens">
          <input inputMode="numeric" placeholder="비워두기" {...field("maxCompletionTokens")} />
        </SettingsField>
        <SettingsField label="Top P">
          <input placeholder="비워두기" {...field("topP")} />
        </SettingsField>
        <SettingsField label="Service tier">
          <input placeholder="비워두기" {...field("serviceTier")} />
        </SettingsField>
        <SettingsField
          label="문서 처리 작업 수"
          help="이미지 준비, DB 저장, 워크플로우 진행 같은 로컬 작업 수입니다. 대량 처리 기본값은 16입니다."
        >
          <input inputMode="numeric" placeholder="16" {...field("workflowMaxWorkers")} />
        </SettingsField>
        <SettingsField
          label="AI 동시 요청 수"
          help="Gemini/OpenAI로 동시에 보내는 요청 수입니다. production 예시는 provider quota 보호를 위해 8로 둡니다."
        >
          <input inputMode="numeric" placeholder="128" {...field("vlmMaxConcurrentRequests")} />
        </SettingsField>
        <SettingsField
          label="VLM timeout 초"
          help="로컬 26B급 모델은 300~900초처럼 길게 잡으세요. 화면은 서버 job이 끝날 때까지 계속 대기합니다."
        >
          <input inputMode="numeric" placeholder="120" {...field("vlmTimeoutSeconds")} />
        </SettingsField>
        <SettingsField label="KIE field group 크기">
          <input inputMode="numeric" placeholder="2" {...field("kieFieldGroupSize")} />
        </SettingsField>
        <div className="settings-actions">
          <Button size="sm" disabled={Boolean(busy)} onClick={props.onClose}>
            닫기
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Save size={16} />}
            disabled={Boolean(busy) || !writable}
            onClick={() => void save()}
          >
            저장
          </Button>
        </div>
      </div>
      <div className="danger-zone">
        <div>
          <strong>파싱 기록 삭제</strong>
          <span>저장된 schema는 유지하고 문서, batch, 추출 결과, raw extraction 기록만 비웁니다.</span>
        </div>
        <Button
          variant="danger-outline"
          size="sm"
          icon={<Trash2 size={16} />}
          disabled={Boolean(busy)}
          onClick={() => void clearHistory()}
        >
          기록 비우기
        </Button>
      </div>
      <div className="settings-status">
        <span>{settings?.has_api_key ? "API key 저장됨" : "API key 미설정"}</span>
        <span>env: {settings?.env_path || ".env"}</span>
        {!writable && <span className="warning-text">호스팅 환경 변수로 관리됨</span>}
        {message && <span className="success-text">{message}</span>}
      </div>
    </Dialog>
  );
}
