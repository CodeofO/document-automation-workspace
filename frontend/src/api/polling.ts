// 폴링 규칙 (spec B-3): 실행 중 1.5초, 대기 6초, terminal이면 멈춘다. 탭이 숨으면 쉰다.
// 주의(ERROR_NOTE 2026-06-08): 서버 job이 running인 동안 클라이언트가 시간 제한으로 실패 처리하지 않는다.
import { delay } from "../lib/async";
import { isActiveStatus, isTerminalStatus } from "../lib/status";

export const POLL_RUNNING_MS = 1500;
export const POLL_IDLE_MS = 6000;

/**
 * TanStack Query refetchInterval용. status가 없으면(아직 데이터 없음) idle 주기.
 * terminal이면 false로 멈춘다.
 */
export function pollIntervalForStatus(status: string | null | undefined, options: { stopWhenTerminal?: boolean } = {}) {
  if (status && isTerminalStatus(status) && options.stopWhenTerminal !== false) return false as const;
  return isActiveStatus(status) ? POLL_RUNNING_MS : POLL_IDLE_MS;
}

/** 여러 상태 중 하나라도 실행 중이면 빠르게, 아니면 idle 주기로. 목록 화면용(멈추지 않음). */
export function pollIntervalForList(statuses: Iterable<string | null | undefined>): number {
  for (const status of statuses) if (isActiveStatus(status)) return POLL_RUNNING_MS;
  return POLL_IDLE_MS;
}

/**
 * terminal 상태가 될 때까지 기다린다. 시도 횟수 제한이 없다(서버가 끝낼 때까지 기다림).
 * 취소는 signal로만 한다.
 */
export async function pollUntil<T>(
  fetcher: (signal?: AbortSignal) => Promise<T>,
  options: {
    isDone: (value: T) => boolean;
    onProgress?: (value: T, elapsedMs: number) => void;
    intervalMs?: number | ((elapsedMs: number) => number);
    signal?: AbortSignal;
  }
): Promise<T> {
  const startedAt = Date.now();
  while (true) {
    const value = await fetcher(options.signal);
    if (options.isDone(value)) return value;
    const elapsedMs = Date.now() - startedAt;
    options.onProgress?.(value, elapsedMs);
    const interval =
      typeof options.intervalMs === "function" ? options.intervalMs(elapsedMs) : (options.intervalMs ?? POLL_RUNNING_MS);
    await delay(interval, options.signal);
  }
}
