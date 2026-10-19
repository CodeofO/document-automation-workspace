import { describe, expect, it } from "vitest";
import { POLL_IDLE_MS, POLL_RUNNING_MS, pollIntervalForStatus, pollUntil } from "./polling";

describe("pollIntervalForStatus", () => {
  it("실행 중이면 빠르게, terminal이면 멈춘다", () => {
    expect(pollIntervalForStatus("running")).toBe(POLL_RUNNING_MS);
    expect(pollIntervalForStatus("paused")).toBe(POLL_IDLE_MS);
    expect(pollIntervalForStatus("completed")).toBe(false);
    expect(pollIntervalForStatus(undefined)).toBe(POLL_IDLE_MS);
  });
});

describe("pollUntil", () => {
  it("완료될 때까지 횟수 제한 없이 다시 묻는다", async () => {
    let calls = 0;
    const result = await pollUntil(async () => ++calls, { isDone: (value) => value >= 5, intervalMs: 0 });
    expect(result).toBe(5);
    expect(calls).toBe(5);
  });

  it("signal로 중단할 수 있다", async () => {
    const controller = new AbortController();
    const promise = pollUntil(async () => 0, { isDone: () => false, intervalMs: 50, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow();
  });
});
