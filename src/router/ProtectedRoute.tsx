import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

/**
 * Lets a session in without a login screen when it can: first a keyless call
 * (gateways that trust loopback, e.g. behind Tailscale Serve), then a stored
 * key. Only when both fail does it hand over to the login page.
 */
export function ProtectedRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const managementKey = useAuthStore((state) => state.managementKey);
  const apiBase = useAuthStore((state) => state.apiBase);
  const checkAuth = useAuthStore((state) => state.checkAuth);
  const connectKeyless = useAuthStore((state) => state.connectKeyless);
  const [restoreFailed, setRestoreFailed] = useState(false);

  useEffect(() => {
    if (isAuthenticated) return;
    let cancelled = false;
    setRestoreFailed(false);
    const restore = async () => {
      const connected =
        (await connectKeyless()) || (Boolean(managementKey && apiBase) && (await checkAuth()));
      if (!cancelled && !connected) setRestoreFailed(true);
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [apiBase, isAuthenticated, managementKey, checkAuth, connectKeyless]);

  if (isAuthenticated) return children;

  if (!restoreFailed) {
    return (
      <div className="main-content">
        <LoadingSpinner />
      </div>
    );
  }

  return <Navigate to="/login" replace state={{ from: location }} />;
}
