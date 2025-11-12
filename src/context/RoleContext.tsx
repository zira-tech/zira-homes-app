import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useImpersonation } from "@/hooks/useImpersonation";
import { measureApiCall } from "@/utils/performanceMonitor";

interface RoleContextType {
  userRole: string | null;
  effectiveRole: string | null;
  assignedRoles: string[];
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
  const [subUserPermissions, setSubUserPermissions] = useState<Record<string, boolean> | null>(null);
  const [landlordId, setLandlordId] = useState<string | null>(null);
  const [isOnLandlordTrial, setIsOnLandlordTrial] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setUserRole(null);
      setAssignedRoles([]);
      setLoading(false);
      return;
    }

    const fetchUserRole = async () => {
      try {
        // If impersonating, set role from impersonation context
        if (isImpersonating && impersonatedRole) {
          setUserRole(impersonatedRole.toLowerCase());
          setAssignedRoles([impersonatedRole.toLowerCase()]);
          setLoading(false);
          return;
        }

        // Fetch the single role assigned to the user
        const { data: roleData, error: roleError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (roleError) {
          console.error("Error fetching role:", roleError);
          setUserRole(null);
          setAssignedRoles([]);
          setLoading(false);
          return;
        }

        const role = roleData?.role?.toLowerCase() || null;
        setUserRole(role);
        setAssignedRoles(role ? [role] : []);

        // Special handling for specific roles
        if (role === "landlord") {
          // Check if landlord is on trial
          const { data: subscriptionData } = await supabase
            .from('landlord_subscriptions')
            .select('status, trial_end_date')
            .eq('landlord_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          
          if (subscriptionData?.status === 'trial' && subscriptionData?.trial_end_date) {
            const trialEndDate = new Date(subscriptionData.trial_end_date);
            setIsOnLandlordTrial(trialEndDate > new Date());
          }
        } else if (role === "subuser") {
          // Fetch sub-user permissions and landlord_id
          const { data: subUserData } = await supabase.rpc('get_my_sub_user_permissions');
          const subUserInfo = subUserData as { permissions?: Record<string, boolean>; landlord_id?: string; status?: string } | null;
          
          if (subUserInfo && (subUserInfo.permissions || subUserInfo.status)) {
            if (subUserInfo.permissions) setSubUserPermissions(subUserInfo.permissions);
            setLandlordId(subUserInfo.landlord_id || null);
            
            // Check if the landlord is on trial
            if (subUserInfo.landlord_id) {
              const { data: landlordSubscription } = await supabase
                .from('landlord_subscriptions')
                .select('status, trial_end_date')
                .eq('landlord_id', subUserInfo.landlord_id)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
              
              if (landlordSubscription?.status === 'trial' && landlordSubscription?.trial_end_date) {
                const trialEndDate = new Date(landlordSubscription.trial_end_date);
                setIsOnLandlordTrial(trialEndDate > new Date());
              }
            }
          }
        }
      } catch (error) {
        console.error("Error in fetchUserRole:", error);
        setUserRole(null);
        setAssignedRoles([]);
      } finally {
        setLoading(false);
      }
    };

    fetchUserRole();
  }, [user, isImpersonating, impersonatedRole]);

  // Calculate effective role (only impersonation can override, no role switching)
  const effectiveRole = (isImpersonating && impersonatedRole)
    ? impersonatedRole.toLowerCase()
    : userRole;

  // Role flags
  const isAdmin = effectiveRole === "admin";
  const isLandlord = effectiveRole === "landlord";
  const isTenant = effectiveRole === "tenant";
  const isManager = effectiveRole === "manager";
  const isAgent = effectiveRole === "agent";
  const isSubUser = effectiveRole === "subuser";

  const value: RoleContextType = {
    userRole,
    effectiveRole,
    assignedRoles,
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
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
};
