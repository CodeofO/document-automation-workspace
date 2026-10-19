// localStorage 래퍼. 사파리 프라이빗 모드 등에서 접근 자체가 throw할 수 있어서 모두 try/catch로 감싼다.

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장소를 쓸 수 없는 환경이면 무시한다.
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 무시
  }
}

export function readJson<T>(key: string): T | null {
  const raw = readStorage(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeStorage(key, JSON.stringify(value));
}

/**
 * 버전 있는 저장 값. 키에 버전(_v1 등)을 붙여 두고, 파서가 형식을 검증한다.
 * 파서가 null을 돌려주면 기본값을 쓴다.
 */
export function createStoredValue<T>(options: {
  key: string;
  parse: (raw: unknown) => T | null;
  fallback: T;
}) {
  return {
    key: options.key,
    read(): T {
      const raw = readJson<unknown>(options.key);
      if (raw === null) return options.fallback;
      return options.parse(raw) ?? options.fallback;
    },
    write(value: T) {
      writeJson(options.key, value);
    },
    clear() {
      removeStorage(options.key);
    }
  };
}

/** 숫자 하나를 저장하는 값(패널 너비 등). 범위를 벗어나면 잘라 쓴다. */
export function createStoredNumber(key: string, fallback: number, min = -Infinity, max = Infinity) {
  return {
    key,
    read(): number {
      const raw = readStorage(key);
      if (raw === null) return fallback;
      const parsed = Number.parseFloat(raw);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(max, Math.max(min, parsed));
    },
    write(value: number) {
      writeStorage(key, String(value));
    }
  };
}
