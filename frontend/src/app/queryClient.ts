import { QueryClient } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 폴링은 각 쿼리가 refetchInterval로 정한다. 탭이 숨으면 쉰다.
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 2_000
      },
      mutations: { retry: 0 }
    }
  });
}
