import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserActivity } from "@/hooks/useUserActivity";
import { Plus, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const tenantFormSchemaBase = z.object({
  first_name: z.string().min(1, "First name is required").transform((s) => s.trim()),
  last_name: z.string().min(1, "Last name is required").transform((s) => s.trim()),
  email: z.string().email("Invalid email address").transform((s) => s.trim()),
  phone: z.string()
    .min(1, "Phone number is required")
    .transform((s) => s.trim())
    .refine((phone) => /^\+[1-9][0-9]{7,14}$/.test(phone), {
      message: "Please enter a valid phone number in international format (e.g., +254712345678)"
    }),
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
  const [existingTenant, setExistingTenant] = useState<any>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
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
      monthly_income: undefined,
      emergency_contact_name: "",
      emergency_contact_phone: "",
      previous_address: "",
      property_id: "",
      unit_id: "",
      lease_start_date: "",
      lease_end_date: "",
      monthly_rent: undefined,
      security_deposit: undefined,
    },
  });

  React.useEffect(() => {
    if (isOpen) {
      fetchProperties();
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (selectedPropertyId) {
      fetchUnits(selectedPropertyId);
    } else {
      setUnits([]);
    }
  }, [selectedPropertyId]);

  const fetchProperties = async () => {
    try {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      setProperties(data || []);
    } catch (error) {
      console.error('Error fetching properties:', error);
      toast({
        title: "Error",
        description: "Failed to load properties",
        variant: "destructive",
      });
    }
  };

  const fetchUnits = async (propertyId: string) => {
    try {
      const { data: unitsList, error } = await supabase
        .from('units')
        .select('id, unit_number, status')
        .eq('property_id', propertyId)
        .order('unit_number');

      if (error) throw error;

      if (unitsList && unitsList.length > 0) {
        const { data: activeLeaseUnits } = await supabase
          .from('leases')
          .select('unit_id')
          .eq('status', 'active');

        if (activeLeaseUnits && activeLeaseUnits.length > 0) {
          const blocked = new Set(activeLeaseUnits.map((l: any) => l.unit_id));
          setUnits(unitsList.filter((u: any) => !blocked.has(u.id)));
          return;
        }
      }

      setUnits(unitsList || []);
    } catch (error) {
      console.error('Error fetching units:', error);
      setUnits([]);
    }
  };

  const checkForExistingTenant = async (email: string, phone: string) => {
    try {
      const { data: result, error } = await supabase
        .rpc('lookup_tenant_in_portfolio', {
          p_email: email,
          p_phone: phone
        });

      if (error) {
        console.error('Lookup error:', error);
        return null;
      }

      return result;
    } catch (error) {
      console.error('Error checking for existing tenant:', error);
      return null;
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

    if (data.unit_id) {
      const existing = await checkForExistingTenant(data.email, data.phone);
      
      if (existing) {
        setExistingTenant(existing);
        setShowConfirmDialog(true);
        return;
      }
    }

    await createTenant(data);
  };

  const handleAttachLease = async () => {
    setShowConfirmDialog(false);
    const data = form.getValues();
    await createTenant(data, existingTenant.id);
  };

  const createTenant = async (data: TenantFormData, existingTenantId?: string) => {
    setLoading(true);
    let hardTimeout: NodeJS.Timeout;
    let watchdog: NodeJS.Timeout;

    try {
      hardTimeout = setTimeout(() => {
        setLoading(false);
        toast({
          title: "Request Timed Out",
          description: "The request took too long. Please try again.",
          variant: "destructive",
        });
      }, 20000);

      watchdog = setTimeout(() => {
        toast({
          title: existingTenantId ? "Adding lease..." : "Creating tenant...",
          description: existingTenantId 
            ? "Adding new lease to existing tenant. Please wait..."
            : "Creating tenant and setting up their account. Please wait...",
        });
      }, 10000);

      logActivity('tenant_create_attempt', 'tenant', undefined, { 
        property_id: data.property_id, 
        unit_id: data.unit_id, 
        has_lease: !!data.unit_id,
        is_attachment: !!existingTenantId
      }).catch(console.error);

      const { data: result, error: rpcError } = await supabase.rpc('create_or_attach_tenant_lease', {
        p_first_name: data.first_name,
        p_last_name: data.last_name,
        p_email: data.email,
        p_phone: data.phone,
        p_national_id: data.national_id,
        p_employment_status: data.employment_status || null,
        p_profession: data.profession || null,
        p_employer_name: data.employer_name || null,
        p_monthly_income: data.monthly_income || null,
        p_emergency_contact_name: data.emergency_contact_name || null,
        p_emergency_contact_phone: data.emergency_contact_phone || null,
        p_previous_address: data.previous_address || null,
        p_property_id: data.property_id || null,
        p_unit_id: data.unit_id || null,
        p_lease_start_date: data.lease_start_date || null,
        p_lease_end_date: data.lease_end_date || null,
        p_monthly_rent: data.monthly_rent || null,
        p_security_deposit: data.security_deposit || null,
        p_existing_tenant_id: existingTenantId || null,
        p_allow_attach: true,
      });

      clearTimeout(hardTimeout);
      clearTimeout(watchdog);

      if (rpcError) throw rpcError;

      const resultData = result as any;
      toast({
        title: "Success",
        description: resultData.tenant_created 
          ? "Tenant created successfully"
          : "Lease added to existing tenant successfully",
      });

      form.reset();
      handleOpenChange(false);
      setExistingTenant(null);
      if (onTenantAdded) onTenantAdded();
    } catch (error: any) {
      clearTimeout(hardTimeout!);
      clearTimeout(watchdog!);
      
      const errorMessage = error?.message || 'Unknown error';
      
      if (errorMessage.includes('already exists in your portfolio')) {
        if (errorMessage.toLowerCase().includes('email')) {
          form.setError("email", { type: "manual", message: "A tenant with this email already exists in your portfolio" });
        } else if (errorMessage.toLowerCase().includes('phone')) {
          form.setError("phone", { type: "manual", message: "A tenant with this phone number already exists in your portfolio" });
        }
        toast({ title: "Duplicate Entry", description: errorMessage, variant: "destructive" });
      } else if (errorMessage.includes('already occupied')) {
        form.setError("unit_id", { type: "manual", message: "This unit is already occupied" });
        toast({ title: "Unit Occupied", description: "This unit is already occupied by another tenant", variant: "destructive" });
      } else if (errorMessage.includes('Invalid phone number format')) {
        form.setError("phone", { type: "manual", message: "Invalid phone format. Use international format (e.g., +254712345678)" });
        toast({ title: "Invalid Phone", description: "Please use international format (e.g., +254712345678)", variant: "destructive" });
      } else {
        toast({ title: "Error", description: errorMessage, variant: "destructive" });
      }

      setTimeout(() => {
        const firstError = document.querySelector('[data-error="true"]') as HTMLElement;
        firstError?.focus();
      }, 100);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tenant Already Exists</AlertDialogTitle>
            <AlertDialogDescription>
              A tenant with this email/phone already exists in your portfolio:
              <div className="mt-3 p-4 bg-muted rounded-lg border border-border">
                <p className="font-semibold text-foreground">
                  {existingTenant?.first_name} {existingTenant?.last_name}
                </p>
                <p className="text-sm text-muted-foreground mt-1">{existingTenant?.email}</p>
                {existingTenant?.phone && (
                  <p className="text-sm text-muted-foreground">{existingTenant?.phone}</p>
                )}
                <p className="text-sm text-muted-foreground mt-2">
                  Currently renting: <span className="font-medium text-foreground">{existingTenant?.current_units || 0}</span> unit(s)
                </p>
              </div>
              <p className="mt-3 text-foreground">Would you like to add another lease for this tenant?</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAttachLease}>
              Yes, Add Another Lease
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        {showTrigger && (
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Add Tenant</Button>
          </DialogTrigger>
        )}
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Tenant</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Personal Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="first_name" render={({ field }) => (
                    <FormItem><FormLabel>First Name *</FormLabel><FormControl><Input {...field} data-error={!!form.formState.errors.first_name} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="last_name" render={({ field }) => (
                    <FormItem><FormLabel>Last Name *</FormLabel><FormControl><Input {...field} data-error={!!form.formState.errors.last_name} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Contact Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem><FormLabel>Email *</FormLabel><FormControl><Input type="email" {...field} data-error={!!form.formState.errors.email} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="phone" render={({ field }) => (
                    <FormItem><FormLabel>Phone *</FormLabel><FormControl><Input {...field} placeholder="+254712345678" data-error={!!form.formState.errors.phone} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Identification</h3>
                <FormField control={form.control} name="national_id" render={({ field }) => (
                  <FormItem><FormLabel>National ID / Passport *</FormLabel><FormControl><Input {...field} data-error={!!form.formState.errors.national_id} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Employment Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="employment_status" render={({ field }) => (
                    <FormItem><FormLabel>Employment Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="employed">Employed</SelectItem>
                          <SelectItem value="self-employed">Self Employed</SelectItem>
                          <SelectItem value="unemployed">Unemployed</SelectItem>
                          <SelectItem value="student">Student</SelectItem>
                          <SelectItem value="retired">Retired</SelectItem>
                        </SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="profession" render={({ field }) => (
                    <FormItem><FormLabel>Profession</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="employer_name" render={({ field }) => (
                    <FormItem><FormLabel>Employer Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="monthly_income" render={({ field }) => (
                    <FormItem><FormLabel>Monthly Income</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Emergency Contact</h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="emergency_contact_name" render={({ field }) => (
                    <FormItem><FormLabel>Emergency Contact Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="emergency_contact_phone" render={({ field }) => (
                    <FormItem><FormLabel>Emergency Contact Phone</FormLabel><FormControl><Input {...field} placeholder="+254712345678" /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
              </div>

              <div className="space-y-4">
                <FormField control={form.control} name="previous_address" render={({ field }) => (
                  <FormItem><FormLabel>Previous Address</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Property & Unit Assignment</h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="property_id" render={({ field }) => (
                    <FormItem><FormLabel>Property *</FormLabel>
                      <Select onValueChange={(value) => { field.onChange(value); setSelectedPropertyId(value); }} value={field.value}>
                        <FormControl><SelectTrigger data-error={!!form.formState.errors.property_id}><SelectValue placeholder="Select property" /></SelectTrigger></FormControl>
                        <SelectContent>{properties.map((property) => (<SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>))}</SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="unit_id" render={({ field }) => (
                    <FormItem><FormLabel>Unit *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-error={!!form.formState.errors.unit_id}><SelectValue placeholder="Select unit" /></SelectTrigger></FormControl>
                        <SelectContent>{units.map((unit: any) => (<SelectItem key={unit.id} value={unit.id}>{unit.unit_number}</SelectItem>))}</SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Lease Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="lease_start_date" render={({ field }) => (
                    <FormItem><FormLabel>Lease Start Date *</FormLabel><FormControl><Input type="date" {...field} data-error={!!form.formState.errors.lease_start_date} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="lease_end_date" render={({ field }) => (
                    <FormItem><FormLabel>Lease End Date *</FormLabel><FormControl><Input type="date" {...field} data-error={!!form.formState.errors.lease_end_date} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="monthly_rent" render={({ field }) => (
                    <FormItem><FormLabel>Monthly Rent *</FormLabel><FormControl><Input type="number" {...field} data-error={!!form.formState.errors.monthly_rent} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="security_deposit" render={({ field }) => (
                    <FormItem><FormLabel>Security Deposit</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>Cancel</Button>
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {loading ? "Processing..." : "Add Tenant"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
