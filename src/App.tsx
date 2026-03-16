import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AccessibilityProvider from "./components/AccessibilityProvider";
import { lazy, Suspense } from "react";
import AppShell from "./AppShell";

const AuthenticatedApp = lazy(() => import("./AuthenticatedApp"));

const queryClient = new QueryClient();

export const shouldSkipAuth = (skipAuthEnv?: string) => skipAuthEnv === "true";

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AccessibilityProvider>
        <Toaster />
        <Sonner />
        {shouldSkipAuth(import.meta.env.VITE_SKIP_AUTH) ? (
          <AppShell />
        ) : (
          <Suspense fallback={<div className="flex items-center justify-center h-screen">加载中...</div>}>
            <AuthenticatedApp />
          </Suspense>
        )}
      </AccessibilityProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
