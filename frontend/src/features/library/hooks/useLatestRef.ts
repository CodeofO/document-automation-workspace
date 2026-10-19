import { useEffect, useRef } from "react";

/** 오래 사는 리스너·비동기 루프가 항상 최신 콜백/값을 보게 한다(렌더 중 ref 쓰기 없이). */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
