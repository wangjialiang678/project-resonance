import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import AppRoutes from "./AppRoutes";
import NotFound from "./pages/NotFound";
import AccessibilityProvider from "./components/AccessibilityProvider";
import { useAuth } from "./hooks/useAuth";
import { lazy, Suspense } from "react";

const AuthPage = lazy(() => import("./pages/AuthPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));

const queryClient = new QueryClient();

function AuthenticatedApp() {
  // Auth preserved but bypassed for demo — remove `VITE_SKIP_AUTH` check to re-enable
  const skipAuth = import.meta.env.VITE_SKIP_AUTH !== 'false';
  const { user, loading } = useAuth();

  if (!skipAuth && loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground text-sm">加载中...</div>
      </div>
    );
  }

  const showAuth = !skipAuth && !user;

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="flex items-center justify-center h-screen">加载中...</div>}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {showAuth ? (
            <Route path="*" element={<AuthPage />} />
          ) : (
            <Route
              path="/*"
              element={
                <Layout>
                  <Routes>
                    <Route path="/*" element={<AppRoutes />} />
                  </Routes>
                </Layout>
              }
            />
          )}
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AccessibilityProvider>
        <Toaster />
        <Sonner />
        <AuthenticatedApp />
      </AccessibilityProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
