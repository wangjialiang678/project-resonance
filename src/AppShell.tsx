import { BrowserRouter, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import Layout from "./components/Layout";
import AppRoutes from "./AppRoutes";

const AuthPage = lazy(() => import("./pages/AuthPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));

interface AppShellProps {
  isLoading?: boolean;
  onSignOut?: () => Promise<void>;
  showAuth?: boolean;
}

export default function AppShell({
  isLoading = false,
  onSignOut,
  showAuth = false,
}: AppShellProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground text-sm">加载中...</div>
      </div>
    );
  }

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
                <Layout onSignOut={onSignOut}>
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
