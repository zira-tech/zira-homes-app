import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

interface BillingPlan {
  id: string;
  name: string;
  price: number;
  billing_cycle: string;
  billing_model?: 'percentage' | 'fixed_per_unit' | 'tiered';
  percentage_rate?: number;
  fixed_amount_per_unit?: number;
  tier_pricing?: any;
  currency: string;
}

interface UseUpgradeResult {
  upgradeToPlan: (planId: string, phoneNumber?: string) => Promise<void>;
  isProcessing: boolean;
  error: string | null;
}

export function useUpgrade(): UseUpgradeResult {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upgradeToPlan = async (planId: string, phoneNumber?: string) => {
    if (!user) {
      setError("User not authenticated");
      toast({
        title: "Error",
        description: "You must be logged in to upgrade",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      console.log('🚀 Starting upgrade process:', { planId, userId: user.id });

      // Fetch the selected plan
      const { data: plan, error: planError } = await supabase
        .from('billing_plans')
        .select('*')
        .eq('id', planId)
        .single();

      if (planError || !plan) {
        throw new Error('Failed to fetch billing plan details');
      }

      console.log('📋 Plan details:', plan);

      // Check billing model - commission-based (percentage) can be activated immediately
      if (plan.billing_model === 'percentage') {
        console.log('✅ Commission-based plan - activating directly');

        const { data, error: activateError } = await supabase.functions.invoke(
          'activate-commission-plan',
          {
            body: { planId },
          }
        );

        if (activateError) throw activateError;

        console.log('✅ Commission plan activated:', data);

        toast({
          title: "Plan Activated!",
          description: `You've been upgraded to ${plan.name}. Commission will be calculated automatically.`,
        });

        // Log user activity
        try {
          await supabase.rpc('log_user_activity', {
            _user_id: user.id,
            _action: 'plan_upgrade',
            _details: { plan_id: planId, plan_name: plan.name, billing_model: 'commission' },
          });
        } catch (logError) {
          console.warn('Failed to log activity:', logError);
        }

        // Redirect to dashboard
        setTimeout(() => navigate('/'), 1500);
        return;
      }

      // For fixed or tiered pricing, require M-Pesa payment
      if (!phoneNumber) {
        throw new Error('Phone number is required for payment');
      }

      console.log('💳 Payment required - initiating M-Pesa STK push');

      const { data: mpesaData, error: mpesaError } = await supabase.functions.invoke(
        'mpesa-stk-push',
        {
          body: {
            phone_number: phoneNumber,
            amount: plan.price,
            description: `Upgrade to ${plan.name}`,
            payment_type: 'subscription',
            metadata: {
              plan_id: planId,
              plan_name: plan.name,
              user_id: user.id,
            },
          },
        }
      );

      if (mpesaError) {
        console.error('❌ M-Pesa STK push failed:', mpesaError);
        throw new Error('Failed to initiate M-Pesa payment. Please try again.');
      }

      console.log('✅ M-Pesa STK push initiated:', mpesaData);

      toast({
        title: "Payment Request Sent",
        description: "Please check your phone and enter your M-Pesa PIN to complete the upgrade",
      });

      // Log activity
      try {
        await supabase.rpc('log_user_activity', {
          _user_id: user.id,
          _action: 'payment_initiated',
          _details: {
            plan_id: planId,
            plan_name: plan.name,
            amount: plan.price,
            checkout_request_id: mpesaData?.checkout_request_id,
          },
        });
      } catch (logError) {
        console.warn('Failed to log activity:', logError);
      }

    } catch (err: any) {
      console.error('❌ Upgrade error:', err);
      const errorMessage = err.message || 'Failed to process upgrade';
      setError(errorMessage);
      toast({
        title: "Upgrade Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    upgradeToPlan,
    isProcessing,
    error,
  };
}
