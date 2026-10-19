// API 클라이언트. 화면마다 있던 api<T>() 5벌과 formatApiDetail() 4벌을 대체한다.
//  - apiClient: OpenAPI 스펙(schema.d.ts)으로 타입이 붙은 openapi-fetch 클라이언트
//  - api<T>(): 경로 문자열로 호출하는 기존 방식 (FormData 업로드, 점진 전환용)
// 두 경로 모두 실패 응답을 같은 ApiError로 정규화한다.
import createClient from "openapi-fetch";
import { API_BASE } from "./config";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** 서버가 준 상대 경로(/api/...)를 절대 URL로. blob:, data:, http(s): 는 그대로 둔다. */
export function resolveAssetUrl(url: string): string {
  if (/^(blob:|data:|https?:)/.test(url)) return url;
  return apiUrl(url);
}

export function documentPageThumbnailUrl(documentId: string, pageNumber = 1, width = 96, cacheBuster?: string): string {
  const version = cacheBuster ? `&v=${encodeURIComponent(cacheBuster)}` : "";
  return apiUrl(`/api/documents/${documentId}/pages/${pageNumber}/thumbnail?width=${width}${version}`);
}

export function documentPageImageUrl(documentId: string, pageNumber: number, cacheBuster?: string): string {
  const version = cacheBuster ? `?v=${encodeURIComponent(cacheBuster)}` : "";
  return apiUrl(`/api/documents/${documentId}/pages/${pageNumber}/image${version}`);
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const isForm = options.body instanceof FormData;
  const headers = new Headers(options.headers ?? {});
  if (!isForm && options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(apiUrl(path), { cache: "no-store", ...options, headers });
}

/**
 * FastAPI `detail`을 사람이 읽을 문장으로.
 * - 문자열 그대로
 * - 검증 오류 배열: "loc: msg; ..."
 * - {code, message, hint}: "code: message hint"  (toFriendlyError가 code로 분기한다)
 * - {errors: [...]}: 워크플로우 검증 오류 목록
 */
export function formatApiDetail(detail: unknown): string | null {
  if (detail === null || detail === undefined || detail === "") return null;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as { loc?: unknown[]; msg?: unknown };
          const location = Array.isArray(record.loc) ? record.loc.join(".") : "";
          const message = typeof record.msg === "string" ? record.msg : JSON.stringify(record);
          return location ? `${location}: ${message}` : message;
        }
        return String(item);
      })
      .filter(Boolean);
    return parts.length ? parts.join("; ") : null;
  }
  if (typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (Array.isArray(record.errors) && record.errors.length) return record.errors.map(String).join(", ");
    if (typeof record.code === "string" && typeof record.message === "string") {
      const hint = typeof record.hint === "string" ? ` ${record.hint}` : "";
      return `${record.code}: ${record.message}${hint}`;
    }
    if (typeof record.message === "string") return record.message;
    if (typeof record.msg === "string") return record.msg;
    return JSON.stringify(detail);
  }
  return String(detail);
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  let detail: unknown = null;
  try {
    const body = (await response.json()) as { detail?: unknown } | null;
    detail = body?.detail ?? null;
  } catch {
    // 본문이 JSON이 아니면 상태 코드만 쓴다.
  }
  const fallback = `${response.status} ${response.statusText}`.trim();
  return new ApiError(formatApiDetail(detail) || fallback || "요청에 실패했습니다.", response.status, detail);
}

/** 경로 문자열 기반 호출. JSON 본문은 Content-Type을 자동으로 붙인다. 204는 undefined. */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) throw await errorFromResponse(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** POST/PUT/PATCH용 JSON 바디 헬퍼. */
export function jsonBody(method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, body: JSON.stringify(body) };
}

/**
 * 타입이 붙은 클라이언트. MSW가 테스트 시작 뒤 fetch를 바꾸므로 호출 시점의 fetch를 쓴다.
 * 사용: `unwrap(await apiClient.GET("/api/system/status"))`
 */
export const apiClient = createClient<paths>({
  baseUrl: API_BASE,
  cache: "no-store",
  fetch: (request: Request) => globalThis.fetch(request)
});

/** openapi-fetch 결과를 데이터로 풀고, 실패면 ApiError를 던진다. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) {
    const body = result.error as { detail?: unknown } | undefined;
    const detail = body && typeof body === "object" && "detail" in body ? body.detail : (body ?? null);
    const fallback = `${result.response.status} ${result.response.statusText}`.trim();
    throw new ApiError(formatApiDetail(detail) || fallback, result.response.status, detail);
  }
  return result.data as T;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** 에러를 화면에 보일 문장으로. VLM 설정 오류 코드는 안내 문구로 바꾼다. */
export function toFriendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "요청을 처리하지 못했습니다.";
  if (message.includes("VLM_CREDENTIALS_MISSING") || message.includes("VLM API key and model name are required")) {
    return "VLM 인증 정보가 없습니다. 상단의 설정에서 API key와 model name을 저장하거나 로컬 데모에서는 VLM_PROVIDER=mock을 사용하세요.";
  }
  if (message.includes("VLM_PROVIDER_UNSUPPORTED") || message.includes("Unsupported VLM_PROVIDER")) {
    return "지원하지 않는 VLM_PROVIDER입니다. auto, mock, openai_compatible, google_genai 중 하나를 사용하세요.";
  }
  if (message.includes("VLM_PROVIDER_REQUEST_FAILED")) return message.replace("VLM_PROVIDER_REQUEST_FAILED: ", "");
  if (message.includes("Schema name already exists")) {
    return "이미 저장된 schema 이름입니다. 드롭다운에서 기존 schema를 불러오거나 다른 이름으로 저장하세요.";
  }
  return message;
}
