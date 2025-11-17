import React, { useState, useEffect } from "react";
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
  const [selectedProperty, setSelectedProperty] = useState<string>("");
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
      emergency_contact_name: "",
      emergency_contact_phone: "",
      previous_address: "",
      property_id: "",
      unit_id: "",
      lease_start_date: "",
      lease_end_date: "",
    },
  });

  // Fetch properties
  useEffect(() => {
    const fetchProperties = async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .order('name');

      if (error) {
        console.error('Error fetching properties:', error);
        toast({
          title: "Error",
          description: "Failed to load properties",
          variant: "destructive",
        });
      } else {
        setProperties(data || []);
      }
    };

    if (isOpen) {
      fetchProperties();
    }
  }, [isOpen, toast]);

  // Fetch units for selected property
  useEffect(() => {
    if (!selectedProperty) {
      setUnits([]);
      return;
    }

    const fetchUnits = async () => {
      const { data, error } = await supabase
        .from('units')
        .select('id, unit_number, status, rent_amount, security_deposit')
        .eq('property_id', selectedProperty)
        .order('unit_number');

      if (error) {
        console.error('Error fetching units:', error);
        toast({
          title: "Error",
          description: "Failed to load units",
          variant: "destructive",
        });
      } else {
        setUnits(data || []);
      }
    };

    fetchUnits();
  }, [selectedProperty, toast]);

  // Check for existing tenant in landlord's portfolio
  const checkForExistingTenant = async (email: string, phone: string, nationalId?: string) => {
    try {
      const { data, error } = await supabase
        .rpc('lookup_tenant_in_portfolio', { 
          p_email: email,
          p_phone: phone,
          p_national_id: nationalId || null
        })
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error checking for existing tenant:', error);
      return null;
    }
  };

  // Auto-populate rent when unit is selected
  const handleUnitChange = (unitId: string) => {
    const selectedUnit = units.find(u => u.id === unitId);
    if (selectedUnit) {
      if (selectedUnit.rent_amount) {
        form.setValue('monthly_rent', selectedUnit.rent_amount);
      }
      if (selectedUnit.security_deposit) {
        form.setValue('security_deposit', selectedUnit.security_deposit);
      }
    }
  };

  const onSubmit = async (data: TenantFormData) => {
    if (!user?.id) {
      toast({
        title: "Error",
        description: "You must be logged in to add a tenant",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      // Preflight check: Look for existing tenant in portfolio
      const existing = await checkForExistingTenant(data.email, data.phone, data.national_id);
      
      if (existing && typeof existing === 'object' && 'id' in existing && existing.id) {
        // Found a matching tenant - show confirmation dialog
        setExistingTenant(existing);
        setShowConfirmDialog(true);
        setLoading(false);
        return;
      }

      // No existing tenant found - proceed with creation
      await createTenant(data, null);
      
    } catch (error: any) {
      console.error('Error in tenant creation flow:', error);
      setLoading(false);
      toast({
        title: "Error",
        description: error.message || "Failed to process tenant",
        variant: "destructive",
      });
    }
  };

  const createTenant = async (data: TenantFormData, existingTenantId: string | null) => {
    try {
      setLoading(true);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000)
      );

      const rpcPromise = supabase.rpc('create_or_attach_tenant_lease', {
        p_existing_tenant_id: existingTenantId,
        p_allow_attach: Boolean(existingTenantId),
        p_first_name: data.first_name,
        p_last_name: data.last_name,
        p_email: data.email,
        p_phone: data.phone,
        p_national_id: data.national_id,
        p_profession: data.profession || null,
        p_employment_status: data.employment_status || null,
        p_employer_name: data.employer_name || null,
        p_monthly_income: data.monthly_income || null,
        p_emergency_contact_name: data.emergency_contact_name || null,
        p_emergency_contact_phone: data.emergency_contact_phone || null,
        p_previous_address: data.previous_address || null,
        p_unit_id: data.unit_id,
        p_lease_start_date: data.lease_start_date || null,
        p_lease_end_date: data.lease_end_date || null,
        p_monthly_rent: data.monthly_rent || null,
        p_security_deposit: data.security_deposit || null,
      });

      const result: any = await Promise.race([rpcPromise, timeoutPromise]);

      if (result.error) throw result.error;

      const tenantId = result.data && typeof result.data === 'object' && 'tenant_id' in result.data 
        ? result.data.tenant_id 
        : null;
      
      if (tenantId) {
        await logActivity('tenant_added', 'tenant', tenantId);
      }

      toast({
        title: "Success",
        description: existingTenantId 
          ? `New lease added for ${data.first_name} ${data.last_name}` 
          : `Tenant ${data.first_name} ${data.last_name} added successfully`,
      });

      form.reset();
      handleOpenChange(false);
      setShowConfirmDialog(false);
      setExistingTenant(null);
      onTenantAdded();
    } catch (error: any) {
      console.error('Error creating tenant:', error);
      const errorMessage = error.message || 'Unknown error';
      
      if (errorMessage.toLowerCase().includes('timeout')) {
        toast({
          title: "Request Timeout",
          description: "The operation took too long. Please check if the tenant was added and try again if needed.",
          variant: "destructive",
        });
      } else if (errorMessage.toLowerCase().includes('email')) {
        form.setError("email", { 
          type: "manual", 
          message: "A tenant with this email already exists" 
        });
        toast({ 
          title: "Duplicate Email", 
          description: "This email is already registered", 
          variant: "destructive" 
        });
      } else if (errorMessage.toLowerCase().includes('phone')) {
        form.setError("phone", { 
          type: "manual", 
          message: "A tenant with this phone number already exists" 
        });
        toast({ 
          title: "Duplicate Phone", 
          description: "This phone number is already registered", 
          variant: "destructive" 
        });
      } else if (errorMessage.toLowerCase().includes('national') || errorMessage.toLowerCase().includes('id number')) {
        form.setError("national_id", { 
          type: "manual", 
          message: "A tenant with this ID number already exists in your portfolio" 
        });
        toast({ 
          title: "Duplicate ID", 
          description: "This ID number is already registered to another tenant", 
          variant: "destructive" 
        });
      } else {
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAttach = async () => {
    const formData = form.getValues();
    await createTenant(formData, existingTenant.id);
  };

  const selectedUnit = units.find(u => u.id === form.watch('unit_id'));

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        {showTrigger && (
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Tenant
            </Button>
          </DialogTrigger>
        )}
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Tenant</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Personal Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="first_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name *</FormLabel>
                        <FormControl>
                          <Input {...field} />
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
                        <FormLabel>Last Name *</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email *</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} />
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
                      <FormLabel>Phone *</FormLabel>
                      <FormControl>
                        <Input placeholder="+254712345678" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="national_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>National ID / Passport *</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Employment Information</h3>
                <FormField
                  control={form.control}
                  name="profession"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Profession</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="employment_status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employment Status</FormLabel>
                      <FormControl>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="employed">Employed</SelectItem>
                            <SelectItem value="self-employed">Self-Employed</SelectItem>
                            <SelectItem value="unemployed">Unemployed</SelectItem>
                            <SelectItem value="student">Student</SelectItem>
                            <SelectItem value="retired">Retired</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="employer_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employer Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="monthly_income"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monthly Income (KES)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Emergency Contact</h3>
                <FormField
                  control={form.control}
                  name="emergency_contact_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Emergency Contact Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                      <FormLabel>Emergency Contact Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="+254712345678" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="previous_address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Previous Address</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Unit Assignment & Lease Details</h3>
                <FormField
                  control={form.control}
                  name="property_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Property *</FormLabel>
                      <FormControl>
                        <Select 
                          onValueChange={(value) => {
                            field.onChange(value);
                            setSelectedProperty(value);
                            form.setValue('unit_id', '');
                          }} 
                          value={field.value}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select property" />
                          </SelectTrigger>
                          <SelectContent>
                            {properties.map((property) => (
                              <SelectItem key={property.id} value={property.id}>
                                {property.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="unit_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit *</FormLabel>
                      <FormControl>
                        <Select 
                          onValueChange={(value) => {
                            field.onChange(value);
                            handleUnitChange(value);
                          }} 
                          value={field.value}
                          disabled={!selectedProperty}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select unit" />
                          </SelectTrigger>
                          <SelectContent>
                            {units.map((unit) => (
                              <SelectItem key={unit.id} value={unit.id}>
                                {unit.unit_number} - {unit.status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="lease_start_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lease Start Date *</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
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
                        <FormLabel>Lease End Date *</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="monthly_rent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monthly Rent (KES) *</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      {selectedUnit?.rent_amount && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Default: KES {selectedUnit.rent_amount.toLocaleString()} (can be adjusted)
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="security_deposit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Security Deposit (KES)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      {selectedUnit?.security_deposit && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Default: KES {selectedUnit.security_deposit.toLocaleString()} (can be adjusted)
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-4">
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Tenant
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tenant Already Exists</AlertDialogTitle>
            <AlertDialogDescription>
              We found an existing tenant matching this information in your portfolio:
              <div className="mt-4 p-4 bg-muted rounded-md">
                <div className="space-y-2">
                  <p className="font-medium">{existingTenant?.first_name} {existingTenant?.last_name}</p>
                  <p className="text-sm text-muted-foreground">Email: {existingTenant?.email}</p>
                  <p className="text-sm text-muted-foreground">Phone: {existingTenant?.phone}</p>
                  {existingTenant?.national_id && (
                    <p className="text-sm text-muted-foreground">ID: {existingTenant.national_id}</p>
                  )}
                  {existingTenant?.has_active_lease && (
                    <p className="text-sm text-amber-600">⚠️ This tenant already has an active lease</p>
                  )}
                </div>
              </div>
              <p className="mt-4">
                Would you like to add another lease for this tenant, or create a new tenant profile instead?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowConfirmDialog(false);
              setExistingTenant(null);
            }}>
              Create New Profile
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAttach} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Another Lease to {existingTenant?.first_name}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
