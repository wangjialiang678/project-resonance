import AppShell from "./AppShell";
import { useAuth } from "./hooks/useAuth";

export default function AuthenticatedApp() {
  const { user, loading, signOut } = useAuth();

  return <AppShell isLoading={loading} onSignOut={signOut} showAuth={!user} />;
}
