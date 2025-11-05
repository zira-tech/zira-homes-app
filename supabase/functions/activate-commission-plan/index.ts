import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[ACTIVATE-COMMISSION-PLAN] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    // Use service role key to bypass RLS for subscription updates
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseService.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user) throw new Error("User not authenticated");
    logStep("User authenticated", { userId: user.id });

    const { planId, nextBillingDate } = await req.json();
    if (!planId) {
      throw new Error("Plan ID is required");
    }
    logStep("Request parsed", { planId, nextBillingDate });

    // Get the billing plan and verify it's commission-based
    const { data: plan, error: planError } = await supabaseService
      .from('billing_plans')
      .select('*')
      .eq('id', planId)
      .eq('billing_model', 'percentage')
      .eq('is_active', true)
      .single();

    if (planError || !plan) {
      throw new Error("Commission-based billing plan not found or inactive");
    }
    logStep("Plan retrieved", { planName: plan.name, percentageRate: plan.percentage_rate });

    // Calculate next billing date if not provided (default to end of current month)
    const billingDate = nextBillingDate || (() => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
    })();

    // Update or create the landlord subscription
    const { data: subscription, error: subscriptionError } = await supabaseService
      .from('landlord_subscriptions')
      .upsert({
        landlord_id: user.id,
        billing_plan_id: planId,
        status: 'active',
        subscription_start_date: new Date().toISOString(),
        next_billing_date: billingDate,
        trial_end_date: null, // End trial period
        auto_renewal: true,
        sms_credits_balance: plan.sms_credits_included || 0,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'landlord_id'
      })
      .select();

    if (subscriptionError) {
      logStep("Subscription update failed", { error: subscriptionError });
      throw subscriptionError;
    }
    logStep("Subscription activated successfully", { subscriptionId: subscription?.[0]?.id });

    // Log the activation action
    await supabaseService.rpc('log_user_activity', {
      _user_id: user.id,
      _action: 'commission_plan_activated',
      _entity_type: 'billing_plan',
      _entity_id: planId,
      _details: {
        plan_name: plan.name,
        billing_model: plan.billing_model,
        percentage_rate: plan.percentage_rate
      }
    });
    logStep("Activity logged");

    // Format billing date for notification
    const formattedBillingDate = new Date(billingDate).toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });

    // Insert a notification about monthly billing
    await supabaseService
      .from('notifications')
      .insert({
        user_id: user.id,
        type: 'billing',
        title: `${plan.name} Plan Activated`,
        message: `Your ${plan.name} plan is now active! You'll be charged ${plan.percentage_rate}% commission on rent collected. Your first billing will be on ${formattedBillingDate}.`,
        related_type: 'subscription',
        related_id: subscription?.[0]?.id
      });

    return new Response(JSON.stringify({
      success: true,
      message: "Commission-based plan activated successfully",
      subscription: subscription?.[0],
      plan: {
        name: plan.name,
        percentage_rate: plan.percentage_rate
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});