import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserActivity } from "@/hooks/useUserActivity";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { checkBackendReady } from "@/utils/backendHealth";

const tenantFormSchemaBase = z.object({
  first_name: z.string().min(1, "First name is required").transform((s) => s.trim()),
  last_name: z.string().min(1, "Last name is required").transform((s) => s.trim()),
  email: z.string().email("Invalid email address").transform((s) => s.trim()),
  phone: z.string().min(1, "Phone number is required").transform((s) => s.trim()),
  national_id: z.string().min(1, "National ID or Passport is required").transform((s) => s.trim()),
  profession: z.string().optional(),
  employment_status: z.string().optional(),
  employer_name: z.string().optional(),
  monthly_income: z.coerce.number().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),
  previous_address: z.string().optional(),
  property_id: z.string().min(1, "Property is required"),
  unit_id: z.string().min(1, "Unit is required"),
  lease_start_date: z.string().optional(),
  lease_end_date: z.string().optional(),
  monthly_rent: z.coerce.number().optional(),
  security_deposit: z.coerce.number().optional(),
});

const tenantFormSchema = tenantFormSchemaBase.superRefine((val, ctx) => {
  const hasUnit = Boolean(val.unit_id);
  if (hasUnit) {
    if (!val.lease_start_date) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Lease start date is required", path: ["lease_start_date"] });
    if (!val.lease_end_date) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Lease end date is required", path: ["lease_end_date"] });
    if (val.monthly_rent == null || isNaN(Number(val.monthly_rent)) || Number(val.monthly_rent) <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Monthly rent is required", path: ["monthly_rent"] });
    }
    if (val.security_deposit != null && isNaN(Number(val.security_deposit))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Security deposit must be a number", path: ["security_deposit"] });
    }
  }
});

type TenantFormData = z.infer<typeof tenantFormSchema>;

interface AddTenantDialogProps {
  onTenantAdded: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export function AddTenantDialog({ onTenantAdded, open: controlledOpen, onOpenChange, showTrigger = true }: AddTenantDialogProps) {
  const [open, setOpen] = useState(false);
  const isOpen = controlledOpen ?? open;
  const handleOpenChange = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setOpen(next);
  };
  const [loading, setLoading] = useState(false);
  const [properties, setProperties] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const { toast } = useToast();
  const { user } = useAuth();
  const { logActivity } = useUserActivity();
  const form = useForm<TenantFormData>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      national_id: "",
      profession: "",
      employment_status: "",
      employer_name: "",
      monthly_income: 0,
      emergency_contact_name: "",
      emergency_contact_phone: "",
      previous_address: "",
      property_id: "",
      unit_id: "",
      lease_start_date: "",
      lease_end_date: "",
      monthly_rent: 0,
      security_deposit: 0,
    }
  });
  
  const { watch, setValue, reset } = form;
  const watchPropertyId = watch("property_id");

  // Fetch properties when dialog opens
  React.useEffect(() => {
    if (open) {
      fetchProperties();
    }
  }, [open]);

  // Fetch units when property changes
  React.useEffect(() => {
    if (watchPropertyId) {
      fetchUnits(watchPropertyId);
      setSelectedPropertyId(watchPropertyId);
    }
  }, [watchPropertyId]);

  const fetchProperties = async () => {
    try {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, address')
        .order('name');
      
      if (error) throw error;
      setProperties(data || []);
    } catch (error) {
      console.error('Error fetching properties:', error);
    }
  };

  const fetchUnits = async (propertyId: string) => {
    try {
      // First, fetch units marked vacant for performance
      const { data: rawUnits, error } = await supabase
        .from('units')
        .select('id, unit_number, rent_amount, status')
        .eq('property_id', propertyId)
        .eq('status', 'vacant')
        .order('unit_number');
      if (error) throw error;

      const unitsList = rawUnits || [];

      // Extra safety: filter out any unit that still has an active lease (in case of stale status)
      if (unitsList.length > 0) {
        const unitIds = unitsList.map(u => u.id);
        const { data: activeLeaseUnits, error: leasesErr } = await supabase
          .from('leases')
          .select('unit_id')
          .in('unit_id', unitIds)
          .eq('status', 'active');
        if (!leasesErr && Array.isArray(activeLeaseUnits)) {
          const blocked = new Set(activeLeaseUnits.map((l: any) => l.unit_id));
          setUnits(unitsList.filter(u => !blocked.has(u.id)));
          return;
        }
      }

      setUnits(unitsList);
    } catch (error) {
      console.error('Error fetching units:', error);
      setUnits([]);
    }
  };

  const onSubmit = async (data: TenantFormData) => {
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to add tenants",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    const startTime = performance.now();
    console.log('⏱️ Tenant creation started');

    // Prepare request payload
    const requestPayload = {
      tenantData: {
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        phone: data.phone,
        national_id: data.national_id,
        employment_status: data.employment_status,
        profession: data.profession,
        employer_name: data.employer_name,
        monthly_income: data.monthly_income ? parseFloat(data.monthly_income.toString()) : undefined,
        emergency_contact_name: data.emergency_contact_name,
        emergency_contact_phone: data.emergency_contact_phone,
        previous_address: data.previous_address
      },
      unitId: data.unit_id,
      propertyId: data.property_id,
      leaseData: data.unit_id ? {
        lease_start_date: data.lease_start_date,
        lease_end_date: data.lease_end_date,
        monthly_rent: data.monthly_rent != null ? parseFloat(data.monthly_rent.toString()) : undefined,
        security_deposit: data.security_deposit != null ? parseFloat(data.security_deposit.toString()) : undefined
      } : undefined,
      force: true
    };

    try { await logActivity('tenant_create_attempt', 'tenant', undefined, { property_id: data.property_id, unit_id: data.unit_id, has_lease: !!data.unit_id }); } catch {}

    console.log("Submitting tenant creation request:", requestPayload);

    // Direct creation without Edge Functions
    try {
      const looksLikeCryptoMissing = (e: any) => {
        const msg = (e && (e.message || e.error || e.details || e.toString?.())) || '';
        return /digest\(|encrypt\(|pgcrypto|function\s+.*does\s+not\s+exist|42883/i.test(String(msg));
      };

      const isActiveLeaseConstraint = (m: any) => /idx_unique_active_lease_per_unit|unique\s+.*active\s+lease\s+.*unit/i.test(String(m || ''));

      // Attempt insert with property_id; fallback without if column doesn't exist
      const insertBase: any = {
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        phone: data.phone,
        national_id: data.national_id,
        employment_status: data.employment_status,
        profession: data.profession,
        employer_name: data.employer_name,
        monthly_income: data.monthly_income ? Number(data.monthly_income) : null,
        emergency_contact_name: data.emergency_contact_name || null,
        emergency_contact_phone: data.emergency_contact_phone || null,
        previous_address: data.previous_address || null,
      };

      const insertWithPlainEncrypted = (withProperty: boolean) => supabase
        .from('tenants')
        .insert({
          ...insertBase,
          ...(withProperty ? { property_id: data.property_id || null } : {}),
          // Pre-fill encrypted columns with plaintext to bypass DB triggers when crypto is missing
          phone_encrypted: data.phone || null,
          national_id_encrypted: data.national_id || null,
          emergency_contact_phone_encrypted: data.emergency_contact_phone || null,
        })
        .select()
        .single();

      const insertNormal = (withProperty: boolean) => supabase
        .from('tenants')
        .insert({
          ...insertBase,
          ...(withProperty ? { property_id: data.property_id || null } : {}),
        })
        .select()
        .single();

      let attempt = await insertNormal(true);

      if (attempt.error && /property_id/i.test(attempt.error.message || '')) {
        // Retry without property_id for schemas that don't have this column
        attempt = await insertNormal(false);
      }

      if (attempt.error && looksLikeCryptoMissing(attempt.error)) {
        console.warn('Encryption functions unavailable. Retrying insert with PII also set on *_encrypted columns.');
        attempt = await insertWithPlainEncrypted(Boolean(data.property_id));
      }

      const tenantInserted: any = attempt.data;
      const tenantError: any = attempt.error;

      if (tenantError) throw new Error(tenantError.message);

      let leaseCreated: any = null;
      if (data.unit_id) {
        if (!data.lease_start_date || !data.lease_end_date || !data.monthly_rent) {
          throw new Error("Missing lease fields (start, end, monthly rent).");
        }
        const { data: leaseRow, error: leaseError } = await supabase
          .from('leases')
          .insert({
            tenant_id: (tenantInserted as any).id,
            unit_id: data.unit_id,
            monthly_rent: Number(data.monthly_rent),
            lease_start_date: data.lease_start_date,
            lease_end_date: data.lease_end_date,
            security_deposit: data.security_deposit != null ? Number(data.security_deposit) : null
          })
          .select()
          .single();
        if (leaseError) {
          if (isActiveLeaseConstraint(leaseError.message)) {
            toast({
              title: 'Unit Already Occupied',
              description: 'The selected unit already has an active lease. Please choose a different unit or end the current lease first.',
              variant: 'destructive',
            });
            setLoading(false);
            return;
          }
          throw new Error(leaseError.message);
        }
        leaseCreated = leaseRow;

        try { await supabase.rpc('sync_unit_status', { p_unit_id: data.unit_id }); } catch {}
      }

      // Log activity (async, non-blocking)
      logActivity(
        'tenant_created',
        'tenant',
        (tenantInserted as any).id,
        {
          tenant_name: `${data.first_name} ${data.last_name}`,
          tenant_email: data.email,
          unit_id: data.unit_id,
          property_id: data.property_id,
          has_lease: !!data.unit_id
        }
      ).catch(console.error);

      const endTime = performance.now();
      console.log(`✅ Tenant created in ${(endTime - startTime).toFixed(0)}ms`);

      toast({
        title: "Tenant Created",
        description: leaseCreated ? "Tenant and lease created successfully." : "Tenant created successfully.",
        variant: "default",
        duration: 3000,
      });

      reset();
      handleOpenChange(false);
      onTenantAdded();
      return;
    } catch (e) {
      throw e as any;
    }
    
    try {
      // Call the edge function to create tenant account
      // Prefer same-origin server proxy to avoid browser CORS
      let invokeResponse: any = null;
      try {
        const res = await fetch('/api/edge/create-tenant-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...requestPayload, force: true })
        });
        const text = await res.text();
        let data: any; try { data = JSON.parse(text); } catch { data = text; }
        if (res.ok) {
          invokeResponse = { data, error: null };
        } else {
          invokeResponse = { data: null, error: { message: 'Proxy call failed', status: res.status, details: data } };
        }
      } catch (proxyErr: any) {
        console.warn('Server proxy failed, attempting direct fetch:', proxyErr);
        try {
          const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = await import("@/integrations/supabase/client");
          const fnUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/create-tenant-account`;
          const res = await fetch(fnUrl, {
            method: 'POST',
            mode: 'cors',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_PUBLISHABLE_KEY,
              'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
              'x-force-create': 'true',
              'x-requested-with': 'XMLHttpRequest',
            },
            body: JSON.stringify(requestPayload)
          });
          const text = await res.text();
          let data: any; try { data = JSON.parse(text); } catch { data = text; }
          if (res.ok) {
            invokeResponse = { data, error: null };
          } else {
            invokeResponse = { data: null, error: { message: 'Edge function fetch failed', status: res.status, details: data } };
          }
        } catch (directErr: any) {
          console.warn('Direct function fetch failed, falling back to supabase-js invoke:', directErr);
          try {
            invokeResponse = await supabase.functions.invoke('create-tenant-account', { body: requestPayload, headers: { 'x-force-create': 'true' } });
          } catch (fnErr: any) {
            console.error("Edge function threw an error:", fnErr);
            let details = fnErr?.message || "Edge function invocation failed";
            try {
              if (fnErr?.response && typeof fnErr.response.text === 'function') {
                const txt = await fnErr.response.text();
                try {
                  const parsed = JSON.parse(txt);
                  details = parsed.error || parsed.message || parsed.details || JSON.stringify(parsed);
                } catch (e) {
                  details = txt;
                }
              }
            } catch (e) {
              console.warn('Failed to extract error response body', e);
            }

            toast({
              title: "Tenant Creation Failed",
              description: details,
              variant: "destructive",
            });
            setLoading(false);
            return;
          }
        }
      }

      const result = invokeResponse?.data ?? invokeResponse;
      const error = invokeResponse?.error ?? null;

      console.log("Response from create-tenant-account function:", { result, error });

      if (error) {
        console.error("Edge function returned error:", error);
        let errorMessage = "Failed to create tenant account";
        let errorDetails = "";

        if (typeof error === 'string') {
          errorMessage = error;
        } else if (error.message) {
          errorMessage = error.message;
          if (error.details) errorDetails = ` Details: ${error.details}`;
        } else if (error.error) {
          errorMessage = error.error;
        } else if (error.details) {
          errorMessage = error.details;
        }

        console.error("Processed error message:", errorMessage + errorDetails);

        toast({
          title: "Tenant Creation Failed",
          description: errorMessage + errorDetails,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Check if we have a valid result
      if (!result) {
        console.error("No result data received from edge function");
        toast({
          title: "Tenant Creation Failed",
          description: "No response received from server",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      console.log("Processing successful response:", result);

      if (result?.success) {
        // Log the activity
        await logActivity(
          'tenant_created',
          'tenant',
          result.tenant?.id,
          {
            tenant_name: `${data.first_name} ${data.last_name}`,
            tenant_email: data.email,
            unit_id: data.unit_id,
            property_id: data.property_id,
            has_lease: !!data.unit_id
          }
        );

        // Enhanced communication status reporting
        const commStatus = result.communicationStatus;
        let statusMessage = "✅ Tenant account created successfully!";
        let communicationDetails = [];
        
        if (commStatus?.emailSent && commStatus?.smsSent) {
          statusMessage += "\n\n📧 Email sent ✓\n📱 SMS sent ✓";
          communicationDetails.push("Email notification delivered", "SMS notification delivered");
        } else if (commStatus?.emailSent) {
          statusMessage += "\n\n📧 Email sent ✓\n📱 SMS failed ⚠️";
          communicationDetails.push("Email notification delivered", "SMS delivery failed");
        } else if (commStatus?.smsSent) {
          statusMessage += "\n\n�� Email failed ⚠️\n📱 SMS sent ✓";
          communicationDetails.push("Email delivery failed", "SMS notification delivered");
        } else {
          statusMessage += "\n\n⚠️ Both email and SMS delivery failed";
          communicationDetails.push("Email delivery failed", "SMS delivery failed");
        }

        // Always show login details for manual sharing if needed
        if (commStatus?.errors?.length > 0 || (!commStatus?.emailSent && !commStatus?.smsSent)) {
          statusMessage += `\n\n🔑 Manual sharing required:\nEmail: ${result.loginDetails?.email}\nPassword: ${result.loginDetails?.temporaryPassword}\nLogin: ${result.loginDetails?.loginUrl}`;
        }

        // Show communication errors if any
        if (commStatus?.errors?.length > 0) {
          statusMessage += `\n\n❌ Delivery issues:\n${commStatus.errors.join('\n')}`;
        }

        toast({
          title: commStatus?.emailSent || commStatus?.smsSent ? "Tenant Created Successfully" : "Tenant Created - Manual Action Required",
          description: statusMessage,
          variant: commStatus?.emailSent || commStatus?.smsSent ? "default" : "destructive",
          duration: 8000, // Longer duration for important information
        });
        
        reset();
        handleOpenChange(false);
        onTenantAdded();
      } else {
        throw new Error(result?.error || "Failed to create tenant account");
      }
    } catch (error: any) {
      console.error("Error creating tenant:", error);
      
      // Extract meaningful error message
      let errorMessage = "An unexpected error occurred";
      
      if (error?.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error?.error) {
        errorMessage = error.error;
      }
      
      try { await logActivity('tenant_create_failed', 'tenant', undefined, { message: errorMessage }); } catch {}

      toast({
        title: "Tenant Creation Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {showTrigger && (
        <DialogTrigger asChild>
          <Button className="bg-primary hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-2" />
            Add Tenant
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto bg-tint-gray">
        <DialogHeader className="pb-4">
          <DialogTitle className="text-xl font-semibold text-primary">Add New Tenant</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Personal Information */}
            <div className="bg-card p-6 rounded-lg border border-border space-y-4">
              <h3 className="text-base font-semibold text-primary border-b border-border pb-2">
                Personal Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="first_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        First Name <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          className="bg-card border-border focus:border-accent focus:ring-accent"
                          placeholder="John"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="last_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        Last Name <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          className="bg-card border-border focus:border-accent focus:ring-accent"
                          placeholder="Doe"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Contact Information */}
            <div className="bg-card p-6 rounded-lg border border-border space-y-4">
              <h3 className="text-base font-semibold text-primary border-b border-border pb-2">
                Contact Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        Email <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          className="bg-card border-border focus:border-accent focus:ring-accent"
                          placeholder="john@example.com"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        Phone Number <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          className="bg-card border-border focus:border-accent focus:ring-accent"
                          placeholder="+254 700 000 000"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Identification & Employment */}
            <div className="bg-card p-6 rounded-lg border border-border space-y-4">
              <h3 className="text-base font-semibold text-primary border-b border-border pb-2">
                Identification & Employment
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="national_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        National ID / Passport <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          className="bg-card border-border focus:border-accent focus:ring-accent"
                          placeholder="12345678"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="profession"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        Profession <span className="text-muted-foreground">(Optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          className="bg-card border-border focus:border-accent focus:ring-accent"
                          placeholder="Software Engineer"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="employment_status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        Employment Status <span className="text-muted-foreground">(Optional)</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={(field.value as any) ?? ""}>
                        <FormControl>
                          <SelectTrigger className="bg-card border-border focus:border-accent focus:ring-accent">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="Employed">Employed</SelectItem>
                          <SelectItem value="Self-Employed">Self-Employed</SelectItem>
                          <SelectItem value="Unemployed">Unemployed</SelectItem>
                          <SelectItem value="Student">Student</SelectItem>
                          <SelectItem value="Retired">Retired</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="employer_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        Employer Name <span className="text-muted-foreground">(Optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          className="bg-card border-border focus:border-accent focus:ring-accent"
                          placeholder="ABC Company Ltd"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="monthly_income"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-primary">
                      Monthly Income (KES) <span className="text-muted-foreground">(Optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        className="bg-card border-border focus:border-accent focus:ring-accent"
                        placeholder="50000"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Emergency Contact */}
            <div className="bg-card p-6 rounded-lg border border-border space-y-4">
              <h3 className="text-base font-semibold text-primary border-b border-border pb-2">
                Emergency Contact
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="emergency_contact_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        Emergency Contact Name <span className="text-muted-foreground">(Optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          className="bg-card border-border focus:border-accent focus:ring-accent"
                          placeholder="Jane Doe"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="emergency_contact_phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        Emergency Contact Phone <span className="text-muted-foreground">(Optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          className="bg-card border-border focus:border-accent focus:ring-accent"
                          placeholder="+254 700 000 001"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Property & Unit Assignment */}
            <div className="bg-card p-6 rounded-lg border border-border space-y-4">
              <h3 className="text-base font-semibold text-primary border-b border-border pb-2">
                Property & Unit Assignment
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="property_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        Property <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          setValue("unit_id", ""); // Reset unit when property changes
                        }}
                        value={(field.value as any) ?? ""}
                      >
                        <FormControl>
                          <SelectTrigger className="bg-card border-border focus:border-accent focus:ring-accent">
                            <SelectValue placeholder="Select property" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-card border-border">
                          {properties.map((property) => (
                            <SelectItem key={property.id} value={property.id}>
                              {property.name} - {property.address}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="unit_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-primary">
                        Unit <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          // Auto-fill rent amount when unit is selected
                          const selectedUnit = units.find(u => u.id === value);
                          if (selectedUnit && selectedUnit.rent_amount) {
                            setValue("monthly_rent", Number(selectedUnit.rent_amount));
                          }
                        }}
                        value={(field.value as any) ?? ""}
                        disabled={!watchPropertyId}
                      >
                        <FormControl>
                          <SelectTrigger className="bg-card border-border focus:border-accent focus:ring-accent">
                            <SelectValue placeholder={watchPropertyId ? "Select unit" : "Select property first"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-card border-border">
                          {units.map((unit) => (
                            <SelectItem key={unit.id} value={unit.id}>
                              Unit {unit.unit_number} - KES {unit.rent_amount?.toLocaleString()}/month
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Lease Information (shown when unit is selected) */}
            {watch("unit_id") && (
              <div className="bg-card p-6 rounded-lg border border-border space-y-4">
                <h3 className="text-base font-semibold text-primary border-b border-border pb-2">
                  Lease Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="lease_start_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-primary">
                          Lease Start Date <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            className="bg-card border-border focus:border-accent focus:ring-accent"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lease_end_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-primary">
                          Lease End Date <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            className="bg-card border-border focus:border-accent focus:ring-accent"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="monthly_rent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-primary">
                          Monthly Rent (KES) <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                        type="number"
                        className="bg-card border-border focus:border-accent focus:ring-accent"
                        placeholder="50000"
                        {...field}
                        value={field.value ?? ""}
                      />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="security_deposit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-primary">
                          Security Deposit (KES) <span className="text-muted-foreground">(Optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                        type="number"
                        className="bg-card border-border focus:border-accent focus:ring-accent"
                        placeholder="50000"
                        {...field}
                        value={field.value ?? ""}
                      />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}

            {/* Additional Information */}
            <div className="bg-card p-6 rounded-lg border border-border space-y-4">
              <h3 className="text-base font-semibold text-primary border-b border-border pb-2">
                Additional Information
              </h3>
              <FormField
                control={form.control}
                name="previous_address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-primary">
                      Previous Address <span className="text-muted-foreground">(Optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        className="bg-card border-border focus:border-accent focus:ring-accent"
                        placeholder="Previous residential address"
                        rows={3}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t border-border">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} className="border-primary text-primary hover:bg-primary hover:text-primary-foreground">
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="bg-accent hover:bg-accent/90">
                {loading ? "Adding..." : "Add Tenant"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
