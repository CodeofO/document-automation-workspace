import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveApiBaseUrl } from "./config";

function setLocation(url: string) {
  vi.stubGlobal("location", new URL(url));
}

describe("resolveApiBaseUrl", () => {
  afterEach(() => {
    delete window.__DIGITIZE_CONFIG__;
  });

  it("runtime config(config.js)가 build env보다 우선하고 끝 슬래시를 지운다", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://build.example:9000");
    window.__DIGITIZE_CONFIG__ = { API_BASE_URL: "  https://runtime.example/api///  " };
    expect(resolveApiBaseUrl()).toBe("https://runtime.example/api");
  });

  it("runtime config가 비어 있으면 VITE_API_BASE_URL을 쓴다", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8011/");
    window.__DIGITIZE_CONFIG__ = { API_BASE_URL: "" };
    expect(resolveApiBaseUrl()).toBe("http://127.0.0.1:8011");
  });

  it("로컬 개발 포트에서는 같은 호스트의 8000 포트로 기본 연결한다", () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    setLocation("http://localhost:5173/#home");
    expect(resolveApiBaseUrl()).toBe("http://localhost:8000");
  });

  it("배포 호스트에서는 같은 origin 상대 경로(빈 문자열)를 쓴다", () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    setLocation("https://docs.example.com/");
    expect(resolveApiBaseUrl()).toBe("");
  });
});
