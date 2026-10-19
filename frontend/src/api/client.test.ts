import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { api, ApiError, apiClient, formatApiDetail, toFriendlyError, unwrap } from "./client";
import { API_BASE } from "./config";

describe("formatApiDetail", () => {
  it("문자열·검증 오류 배열·code/message·errors 목록을 문장으로 바꾼다", () => {
    expect(formatApiDetail("없음")).toBe("없음");
    expect(formatApiDetail([{ loc: ["body", "name"], msg: "필수" }])).toBe("body.name: 필수");
    expect(formatApiDetail({ code: "VLM_X", message: "실패", hint: "설정 확인" })).toBe("VLM_X: 실패 설정 확인");
    expect(formatApiDetail({ errors: ["a", "b"] })).toBe("a, b");
    expect(formatApiDetail(null)).toBeNull();
  });
});

describe("api", () => {
  it("실패 응답을 detail 문장의 ApiError로 던진다", async () => {
    server.use(http.get(`${API_BASE}/api/x`, () => HttpResponse.json({ detail: "권한 없음" }, { status: 403 })));
    const error = await api("/api/x").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).message).toBe("권한 없음");
  });

  it("JSON 본문에 Content-Type을 붙인다", async () => {
    let contentType = "";
    server.use(
      http.post(`${API_BASE}/api/y`, ({ request }) => {
        contentType = request.headers.get("content-type") ?? "";
        return HttpResponse.json({ ok: true });
      })
    );
    await expect(api("/api/y", { method: "POST", body: JSON.stringify({ a: 1 }) })).resolves.toEqual({ ok: true });
    expect(contentType).toContain("application/json");
  });
});

describe("apiClient + unwrap", () => {
  it("타입이 붙은 호출 결과를 풀고, 실패는 ApiError로 바꾼다", async () => {
    server.use(
      http.get(`${API_BASE}/api/system/status`, () =>
        HttpResponse.json({ detail: { code: "VLM_CREDENTIALS_MISSING", message: "no key" } }, { status: 400 })
      )
    );
    const error = await apiClient.GET("/api/system/status").then(unwrap).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(toFriendlyError(error)).toContain("VLM 인증 정보가 없습니다");
  });
});
