import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useImpersonation } from "@/hooks/useImpersonation";
import { measureApiCall } from "@/utils/performanceMonitor";

interface RoleContextType {
  userRole: string | null;
  effectiveRole: string | null;
  assignedRoles: string[];
  selectedRole: string | null;
  isAdmin: boolean;
  isLandlord: boolean;
  isTenant: boolean;
  isManager: boolean;
  isAgent: boolean;
  isSubUser: boolean;
  subUserPermissions: Record<string, boolean> | null;
  landlordId?: string | null;
  isOnLandlordTrial?: boolean;
  loading: boolean;
  switchRole: (role: string) => void;
}

const RoleContext = createContext<RoleContextType | null>(null);

export const useRole = (): RoleContextType => {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error("useRole must be used within a RoleProvider");
  }
  return context;
};

interface RoleProviderProps {
  children: ReactNode;
}

export const RoleProvider = ({ children }: RoleProviderProps) => {
  const { user } = useAuth();
  const { isImpersonating, impersonatedRole } = useImpersonation();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [assignedRoles, setAssignedRoles] = useState<string[]>([]);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [subUserPermissions, setSubUserPermissions] = useState<Record<string, boolean> | null>(null);
  const [landlordId, setLandlordId] = useState<string | null>(null);
  const [isOnLandlordTrial, setIsOnLandlordTrial] = useState(false);
  const [loading, setLoading] = useState(true);

  // Optimistic role hydration from localStorage and metadata
  const hydrateFromCache = (user: any) => {
    if (!user) return;
    
    // SECURITY FIX: Don't trust localStorage until server verification
    // Remove optimistic role setting to prevent privilege confusion
    const metadataRole = user.user_metadata?.role?.toLowerCase();
    
    if (metadataRole) {
      setSelectedRole(metadataRole);
      setUserRole(metadataRole);
    }
  };

  useEffect(() => {
    if (!user) {
      setUserRole(null);
      setAssignedRoles([]);
      setSelectedRole(null);
      setLoading(false);
      return;
    }

    // Immediate optimistic hydration
    hydrateFromCache(user);

    const fetchUserRole = async () => {
      try {
        const result = await measureApiCall("role-resolution", async () => {
          // Check metadata first (fastest)
          const metadataRole = user.user_metadata?.role;
          
          // Early tenant detection via metadata
          if (metadataRole === "Tenant") {
            setAssignedRoles(["tenant"]);
            return "tenant";
          }

          // Check if user has an active lease (tenant status)
          const { data: isTenant } = await supabase.rpc('is_user_tenant', { _user_id: user.id });
          
          // Check all management roles
          const rolesToCheck = ["Admin", "Landlord", "Manager", "Agent"] as const;
          const roleChecks = await Promise.all(
            rolesToCheck.map(async (r) => {
              const { data } = await supabase.rpc('has_role_safe', { _user_id: user.id, _role: r as any });
              return { role: r.toLowerCase(), has: Boolean(data) } as { role: string; has: boolean };
            })
          );

          let allRoles = roleChecks.filter(rc => rc.has).map(rc => rc.role);
          
          // Add tenant to roles if they have an active lease
          if (isTenant && !allRoles.includes("tenant")) {
            allRoles.push("tenant");
          }
          
          setAssignedRoles(allRoles);

          // Sub-user check via secure RPC
          try {
            const { data: subUserData } = await supabase.rpc("get_my_sub_user_permissions");
            const subUserInfo = subUserData as { permissions?: Record<string, boolean>; landlord_id?: string; status?: string } | null;
            if (subUserInfo && (subUserInfo.permissions || subUserInfo.status)) {
              if (subUserInfo.permissions) setSubUserPermissions(subUserInfo.permissions);
              setLandlordId(subUserInfo.landlord_id || null);
              if (subUserInfo.landlord_id) {
                const { data: landlordSubscription } = await supabase
                  .from('landlord_subscriptions')
                  .select('status, trial_end_date')
                  .eq('landlord_id', subUserInfo.landlord_id)
                  .eq('status', 'trial')
                  .maybeSingle();
                if (landlordSubscription) {
                  const trialEndDate = new Date(landlordSubscription.trial_end_date);
                  const today = new Date();
                  const isActive = trialEndDate > today;
                  setIsOnLandlordTrial(isActive);
                }
              }
              // Don't auto-select subuser role, let user choose between their roles
              if (!allRoles.includes("subuser")) {
                allRoles.push("subuser");
                setAssignedRoles(allRoles);
              }
            }
          } catch {}

          // SECURITY: Check stored role preference (must be server-verified)
          const storedSelectedRole = localStorage.getItem('selectedRole');
          if (storedSelectedRole && allRoles.includes(storedSelectedRole.toLowerCase())) {
            setSelectedRole(storedSelectedRole.toLowerCase());
            return storedSelectedRole.toLowerCase();
          }

          // Priority for multi-role users: Tenant > Admin > Landlord > Manager > Agent
          // Tenants with active leases should default to tenant view
          if (isTenant && allRoles.includes("tenant")) {
            setSelectedRole("tenant");
            return "tenant";
          }
          if (allRoles.includes("admin")) { 
            setSelectedRole("admin"); 
            return "admin"; 
          }
          if (allRoles.includes("landlord")) { 
            setSelectedRole("landlord"); 
            return "landlord"; 
          }
          if (allRoles.includes("manager")) { 
            setSelectedRole("manager"); 
            return "manager"; 
          }
          if (allRoles.includes("agent")) { 
            setSelectedRole("agent"); 
            return "agent"; 
          }
          
          // Clean up invalid stored role
          if (storedSelectedRole && !allRoles.includes(storedSelectedRole.toLowerCase())) {
            localStorage.removeItem('selectedRole');
          }

          // Fallback to metadata or tenant
          const fallbackRole = metadataRole?.toLowerCase() || (isTenant ? "tenant" : null) || selectedRole || "tenant";
          setSelectedRole(fallbackRole);
          return fallbackRole;
        });

        // Only update if different from optimistic value
        if (result !== userRole) {
          setUserRole(result);
        }
        
        // Set selected role to stored preference or primary role
        const storedRole = localStorage.getItem('selectedRole');
        if (storedRole && assignedRoles.includes(storedRole)) {
          setSelectedRole(storedRole);
        } else if (!selectedRole || selectedRole !== result) {
          setSelectedRole(result);
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
        if (!selectedRole && !userRole) {
          setUserRole("tenant");
          setAssignedRoles(["tenant"]);
          setSelectedRole("tenant");
        }
      } finally {
        setLoading(false);
      }
    };

    // Defer actual API call slightly to allow optimistic render
    setTimeout(fetchUserRole, 0);
  }, [user]);

  // Calculate effective role (considering impersonation and role switching)
  const effectiveRole = (isImpersonating && impersonatedRole)
    ? impersonatedRole.toLowerCase()
    : selectedRole || userRole;

  // Role flags
  const isAdmin = effectiveRole === "admin";
  const isLandlord = effectiveRole === "landlord";
  const isTenant = effectiveRole === "tenant";
  const isManager = effectiveRole === "manager";
  const isAgent = effectiveRole === "agent";
  const isSubUser = effectiveRole === "subuser";

  const switchRole = (role: string) => {
    if (assignedRoles.includes(role)) {
      setSelectedRole(role);
      localStorage.setItem('selectedRole', role);
    }
  };

  const value: RoleContextType = {
    userRole,
    effectiveRole,
    assignedRoles,
    selectedRole,
    isAdmin,
    isLandlord,
    isTenant,
    isManager,
    isAgent,
    isSubUser,
    subUserPermissions,
    landlordId,
    isOnLandlordTrial,
    loading,
    switchRole,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
};
