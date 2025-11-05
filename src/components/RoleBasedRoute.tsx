import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/context/RoleContext";

interface RoleBasedRouteProps {
  children: React.ReactNode;
}

export const RoleBasedRoute = ({ children }: RoleBasedRouteProps) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { effectiveRole, assignedRoles, loading: roleLoading } = useRole();

  if (loading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }
  
  // Redirect from "/" based on role (use assignedRoles as authoritative signal)
  if (location.pathname === "/") {
    // Prioritize tenant role - if user has tenant role OR effectiveRole is tenant, go to tenant portal
    if (assignedRoles.includes("tenant") || effectiveRole === "tenant") {
      return <Navigate to="/tenant" replace />;
    }
    if (effectiveRole === "admin") {
      return <Navigate to="/admin" replace />;
    }
    // Landlord, manager, agent stay on main dashboard
  }

  // Helper to check if we're in actual tenant area (not /tenants which is for landlords)
  const isTenantArea = location.pathname === "/tenant" || location.pathname.startsWith("/tenant/");

  // Block tenant users from accessing non-tenant routes (use assignedRoles as failsafe)
  if ((effectiveRole === "tenant" || assignedRoles.includes("tenant")) && !isTenantArea && location.pathname !== "/auth") {
    return <Navigate to="/tenant" replace />;
  }

  // Block non-tenant users from accessing tenant routes
  // Allow if effectiveRole is tenant OR assignedRoles includes tenant (prevents loop during hydration)
  if (isTenantArea && !(effectiveRole === "tenant" || assignedRoles.includes("tenant"))) {
    return <Navigate to="/" replace />;
  }

  // Block non-admin users from accessing admin routes
  if (location.pathname.startsWith("/admin") && effectiveRole !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
