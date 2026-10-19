import { useEffect, useState } from "react";

/** File을 blob URL로. 파일이 바뀌거나 언마운트되면 해제한다. */
export function useObjectUrl(file: File | null | undefined): string | null {
  const [entry, setEntry] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // blob URL은 외부 자원이라 effect에서 만들고 정리한다(StrictMode 재마운트에도 안전).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntry({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return file && entry?.file === file ? entry.url : null;
}
