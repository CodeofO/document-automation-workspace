import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { DialogProvider, ToastProvider } from "../components/ui";
import { createQueryClient } from "./queryClient";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DialogProvider>{children}</DialogProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
