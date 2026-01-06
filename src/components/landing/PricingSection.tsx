import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Check, Sparkles, Building2, Crown, Zap, Calculator } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLandingSettings } from "@/hooks/useLandingSettings";

interface BillingPlan {
  id: string;
  name: string;
  price: number;
  billing_cycle: string;
  billing_model: string | null;
  percentage_rate: number | null;
  fixed_amount_per_unit: number | null;
  tier_pricing: any;
  currency: string | null;
  description: string | null;
  features: any;
  max_properties: number | null;
  max_units: number | null;
  is_custom: boolean | null;
  sms_credits_included: number | null;
}

const FEATURE_DISPLAY_MAP: Record<string, string> = {
  'property_management': 'Property Management',
  'tenant_management': 'Tenant Management',
  'basic_invoicing': 'Basic Invoicing',
  'payment_tracking': 'Payment Tracking',
  'maintenance_requests': 'Maintenance Requests',
  'tenant_portal': 'Tenant Portal',
  'document_storage': 'Document Storage',
  'lease_management': 'Lease Management',
  'analytics_reports': 'Analytics & Reports',
  'custom_branding': 'Custom Branding',
  'api_access': 'API Access',
  'priority_support': 'Priority Support',
  'sub_users': 'Team Members',
  'bulk_messaging': 'Bulk Messaging',
  'automated_reminders': 'Automated Reminders',
  'mpesa_integration': 'M-Pesa Integration',
};

function getPlanIcon(planName: string) {
  const name = planName.toLowerCase();
  if (name.includes('enterprise') || name.includes('custom')) {
    return Crown;
  } else if (name.includes('professional') || name.includes('pro')) {
    return Sparkles;
  } else if (name.includes('growth') || name.includes('business')) {
    return Zap;
  }
  return Building2;
}

function formatPrice(plan: BillingPlan): string {
  if (plan.is_custom) {
    return "Custom";
  }
  
  if (plan.billing_model === 'percentage' && plan.percentage_rate) {
    return `${plan.percentage_rate}%`;
  }
  
  if (plan.billing_model === 'fixed_per_unit' && plan.fixed_amount_per_unit) {
    return `KES ${plan.fixed_amount_per_unit}`;
  }
  
  if (plan.price === 0) {
    return "Free";
  }
  
  return `KES ${plan.price.toLocaleString()}`;
}

function getPriceSubtext(plan: BillingPlan, trialDays: number): string {
  if (plan.is_custom) {
    return "Contact us for pricing";
  }
  
  if (plan.billing_model === 'percentage') {
    return "of rent collected";
  }
  
  if (plan.billing_model === 'fixed_per_unit') {
    return "per unit / month";
  }
  
  if (plan.price === 0) {
    return `${trialDays} days trial`;
  }
  
  return `/ ${plan.billing_cycle}`;
}

function getDisplayFeatures(features: any): string[] {
  if (!features) return [];
  
  if (Array.isArray(features)) {
    return features.map(f => FEATURE_DISPLAY_MAP[f] || f).slice(0, 8);
  }
  
  if (typeof features === 'object') {
    return Object.entries(features)
      .filter(([_, value]) => value === true)
      .map(([key]) => FEATURE_DISPLAY_MAP[key] || key)
      .slice(0, 8);
  }
  
  return [];
}

export function PricingSection() {
  const { trialDays } = useLandingSettings();
  const { data: plans, isLoading, error } = useQuery({
    queryKey: ['landing-billing-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_plans')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true });
      
      if (error) throw error;
      return (data as BillingPlan[]).filter(p => !p.name.toLowerCase().includes('free trial'));
    },
    staleTime: 1000 * 60 * 5,
  });

  return (
    <section id="pricing" className="py-20 bg-secondary/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <span className="inline-block px-4 py-1 rounded-full bg-success/10 text-success text-sm font-medium mb-4">
            Pricing
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-lg text-muted-foreground mb-6">
            Choose the plan that fits your portfolio. Start with a free trial and upgrade anytime.
          </p>
          
          {/* Small Landlord Callout */}
          <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl bg-accent/10 border border-accent/20">
            <Calculator className="w-5 h-5 text-accent" />
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">Even with just 1 unit? Pay only KES 100/month</p>
              <p className="text-xs text-muted-foreground">Example: 5 units = KES 500/month • 10 SMS per unit included</p>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card rounded-2xl p-6 border border-border">
                <Skeleton className="h-6 w-24 mb-4" />
                <Skeleton className="h-10 w-32 mb-2" />
                <Skeleton className="h-4 w-20 mb-6" />
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((j) => (
                    <Skeleton key={j} className="h-4 w-full" />
                  ))}
                </div>
                <Skeleton className="h-12 w-full mt-6" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Unable to load pricing. Please try again later.</p>
          </div>
        )}

        {/* Plans Grid */}
        {plans && plans.length > 0 && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((plan, index) => {
              const Icon = getPlanIcon(plan.name);
              const isPopular = index === 1 || plan.name.toLowerCase().includes('professional');
              const features = getDisplayFeatures(plan.features);
              
              return (
                <div 
                  key={plan.id}
                  className={`relative bg-card rounded-2xl p-6 border transition-all duration-300 hover:shadow-lg ${
                    isPopular 
                      ? 'border-primary shadow-lg ring-2 ring-primary/20' 
                      : 'border-border hover:border-primary/30'
                  }`}
                >
                  {/* Popular Badge */}
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                        <Sparkles className="w-3 h-3" />
                        Most Popular
                      </span>
                    </div>
                  )}
                  
                  {/* Plan Header */}
                  <div className="mb-6">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
                      isPopular ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
                    }`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-1">
                      {plan.name}
                    </h3>
                    {plan.description && (
                      <p className="text-sm text-muted-foreground">
                        {plan.description}
                      </p>
                    )}
                  </div>
                  
                  {/* Price */}
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-foreground">
                        {formatPrice(plan)}
                      </span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {getPriceSubtext(plan, trialDays)}
                    </span>
                  </div>
                  
                  {/* Limits */}
                  {(plan.max_properties || plan.max_units) && (
                    <div className="flex gap-4 mb-6 text-sm">
                      {plan.max_properties && (
                        <div className="text-muted-foreground">
                          <span className="font-medium text-foreground">{plan.max_properties}</span> Properties
                        </div>
                      )}
                      {plan.max_units && (
                        <div className="text-muted-foreground">
                          <span className="font-medium text-foreground">{plan.max_units === 999999 ? 'Unlimited' : plan.max_units}</span> Units
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Features */}
                  <ul className="space-y-3 mb-6">
                    {features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-foreground">{feature}</span>
                      </li>
                    ))}
                    {plan.max_units && plan.max_units > 0 && (
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-foreground">
                          10 SMS per unit included
                        </span>
                      </li>
                    )}
                  </ul>
                  
                  {/* CTA Button */}
                  <Link to="/auth" className="block">
                    <Button 
                      className={`w-full ${
                        isPopular 
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90' 
                          : plan.is_custom 
                            ? 'bg-accent text-accent-foreground hover:bg-accent/90'
                            : ''
                      }`}
                      variant={isPopular || plan.is_custom ? "default" : "outline"}
                    >
                      {plan.is_custom ? 'Contact Sales' : 'Start Free Trial'}
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
        
        {/* Bottom note */}
        <p className="text-center text-sm text-muted-foreground mt-8">
          All plans include a {trialDays}-day free trial. No credit card required.
        </p>
      </div>
    </section>
  );
}
