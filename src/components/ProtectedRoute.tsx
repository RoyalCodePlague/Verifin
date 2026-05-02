import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { PageSkeleton } from "@/components/ui/page-skeleton";

function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="w-full max-w-lg">
        <PageSkeleton />
      </div>
    </div>
  );
}

/** Dashboard and app areas: require login and completed onboarding. */
export function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { isAuthenticated, isLoading, user, isStaffSession, canAccess } = useAuth();
  if (isLoading) return <AuthLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user && !isStaffSession && !user.onboarding_complete) return <Navigate to="/onboarding" replace />;
  if (permission && !canAccess(permission)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Onboarding wizard: only while logged in and onboarding not yet done. */
export function OnboardingRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <AuthLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.onboarding_complete) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Login page: redirect authenticated users away. */
export function GuestRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user, isStaffSession } = useAuth();
  if (isLoading) return <AuthLoading />;
  if (isAuthenticated && user) {
    if (!isStaffSession && !user.onboarding_complete) return <Navigate to="/onboarding" replace />;
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
