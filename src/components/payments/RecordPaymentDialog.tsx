import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { formatAmount, getGlobalCurrencySync } from "@/utils/currency";
import { Plus } from "lucide-react";

interface PaymentFormData {
  tenant_id: string;
  lease_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  payment_type: string;
  payment_reference: string;
  invoice_id?: string;
  invoice_number?: string;
  notes?: string;
}

interface RecordPaymentDialogProps {
  tenants: any[];
  leases: any[];
  invoices?: any[];
  onPaymentRecorded: () => void;
}

export function RecordPaymentDialog({ tenants, leases, invoices = [], onPaymentRecorded }: RecordPaymentDialogProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const { register, handleSubmit, reset, setValue, watch, formState: { errors }, trigger } = useForm<PaymentFormData>();

  useEffect(() => {
    register("tenant_id", { required: "Tenant is required" });
    register("lease_id", { required: "Lease is required" });
    register("payment_method", { required: "Payment method is required" });
    register("payment_type", { required: "Payment type is required" });
  }, [register]);
  const selectedTenantId = watch("tenant_id");
  const selectedInvoiceId = watch("invoice_id");
  const filteredLeases = leases.filter(lease => lease.tenant_id === selectedTenantId);
  const filteredInvoices = invoices.filter(invoice => invoice.tenant_id === selectedTenantId && (invoice.outstanding_amount || 0) > 0);

  const getErrorMessage = (e: any): string => {
    try {
      if (!e) return "Unknown error";
      if (typeof e === "string") return e;
      const parts: string[] = [];
      if (e.message) parts.push(e.message);
      if (e.details) parts.push(e.details);
      if (e.hint) parts.push(`hint: ${e.hint}`);
      if (e.code) parts.push(`code: ${e.code}`);
      if (parts.length > 0) return parts.join(" | ");
      if (e.status && e.statusText) return `${e.status} ${e.statusText}`;
      try { return JSON.stringify(e); } catch {}
      return String(e);
    } catch {
      return String(e);
    }
  };
const onSubmit = async (data: PaymentFormData) => {
    try {
      // Resolve invoice_id if user typed an invoice number that matches an existing invoice
      let resolvedInvoiceId: string | null = data.invoice_id || null;
      if (!resolvedInvoiceId && data.invoice_number && selectedTenantId) {
        const typed = String(data.invoice_number).trim();
        const match = filteredInvoices.find((inv) => String(inv.invoice_number).trim() === typed);
        if (match?.id) resolvedInvoiceId = match.id;
      }

      // Create the payment record (do NOT include invoice_number; avoid DB auto-link trigger recursion)
      const paymentData = {
        tenant_id: data.tenant_id,
        lease_id: data.lease_id,
        amount: Number(data.amount),
        payment_date: data.payment_date,
        payment_method: data.payment_method,
        payment_type: data.payment_type,
        payment_reference: data.payment_reference,
        notes: data.notes ?? null,
        status: 'completed',
        invoice_id: resolvedInvoiceId
      } as const;

      // RLS-safe insert: do not require returning row
      const { error: insertError } = await supabase
        .from("payments")
        .insert([paymentData]);

      if (insertError) {
        const msg = getErrorMessage(insertError);
        const isNoReturn = msg.includes("PGRST116") || msg.includes("Results contain 0");
        if (!isNoReturn) throw insertError;
      }

      // If invoice is resolved, create allocation by reliably fetching the just-inserted payment via unique reference
      if (resolvedInvoiceId) {
        try {
          const { data: createdPayment, error: fetchErr } = await supabase
            .from("payments")
            .select("id")
            .eq("tenant_id", data.tenant_id)
            .eq("payment_reference", data.payment_reference)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (fetchErr) throw fetchErr;
          if (createdPayment?.id) {
            const { error: allocationError } = await supabase
              .from("payment_allocations" as any)
              .insert([{ payment_id: createdPayment.id, invoice_id: resolvedInvoiceId, amount: Number(data.amount) }]) as { error: any };
            if (allocationError) console.warn("Payment created but allocation failed:", allocationError);
          } else {
            console.warn("Payment created but could not find it by reference for allocation");
          }
        } catch (e) {
          console.warn("Skipped allocation fetch/insert:", e);
        }
      }

      // Auto-reconcile for the tenant to allocate any remaining amount
      if (data.tenant_id) {
        try {
          await supabase.rpc('reconcile_unallocated_payments_for_tenant' as any, { p_tenant_id: data.tenant_id }) as { data: any, error: any };
        } catch (reconcileError) {
          console.warn("Payment created but reconciliation failed:", reconcileError);
        }
      }

      toast({
        title: "Success",
        description: "Payment recorded successfully",
      });

      reset();
      setDialogOpen(false);
      onPaymentRecorded();
    } catch (error) {
      const msg = getErrorMessage(error);
      console.error("Error recording payment:", msg, error);
      toast({
        title: "Error recording payment",
        description: msg,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <Plus className="h-4 w-4 mr-2" />
          Record Payment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Record New Payment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="tenant_id">Tenant</Label>
            <Select onValueChange={(value) => { setValue("tenant_id", value); trigger("tenant_id"); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map(tenant => (
                  <SelectItem key={tenant.id} value={tenant.id}>
                    {tenant.first_name} {tenant.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.tenant_id && <p className="text-sm text-destructive">Tenant is required</p>}
          </div>

          <div>
            <Label htmlFor="lease_id">Lease</Label>
            <Select onValueChange={(value) => { setValue("lease_id", value); trigger("lease_id"); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select lease" />
              </SelectTrigger>
              <SelectContent>
                {filteredLeases.map(lease => (
                  <SelectItem key={lease.id} value={lease.id}>
                    {lease.units?.properties?.name} - Unit {lease.units?.unit_number} ({formatAmount(lease.monthly_rent)}/month)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.lease_id && <p className="text-sm text-destructive">Lease is required</p>}
          </div>

          <div>
            <Label htmlFor="invoice_id">Invoice (Optional)</Label>
            <Select onValueChange={(value) => setValue("invoice_id", value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select invoice to allocate payment" />
              </SelectTrigger>
              <SelectContent>
                {filteredInvoices.map(invoice => (
                  <SelectItem key={invoice.id} value={invoice.id}>
                    {invoice.invoice_number} - {formatAmount(invoice.outstanding_amount || invoice.amount)} outstanding
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="amount">Amount ({getGlobalCurrencySync()})</Label>
              <Input
                id="amount"
                type="number"
                {...register("amount", { required: "Amount is required", min: { value: 0.01, message: "Amount must be greater than 0" } })}
                placeholder="25000"
              />
              {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
            </div>
            <div>
              <Label htmlFor="payment_date">Payment Date</Label>
              <Input
                id="payment_date"
                type="date"
                {...register("payment_date", { required: "Payment date is required" })}
              />
              {errors.payment_date && <p className="text-sm text-destructive">{errors.payment_date.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="payment_method">Payment Method</Label>
              <Select onValueChange={(value) => { setValue("payment_method", value); trigger("payment_method"); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="M-Pesa">M-Pesa</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="payment_type">Payment Type</Label>
              <Select onValueChange={(value) => { setValue("payment_type", value); trigger("payment_type"); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Rent">Rent</SelectItem>
                  <SelectItem value="Security Deposit">Security Deposit</SelectItem>
                  <SelectItem value="Utility">Utility</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="payment_reference">Payment Reference</Label>
              <Input
                id="payment_reference"
                {...register("payment_reference", { required: "Payment reference is required" })}
                placeholder="REF-2024-001"
              />
              {errors.payment_reference && (
                <p className="text-sm text-destructive">{errors.payment_reference.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="invoice_number">Invoice Number</Label>
              <Input
                id="invoice_number"
                {...register("invoice_number")}
                placeholder="INV-2024-001 (optional)"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Input
              id="notes"
              {...register("notes")}
              placeholder="Payment notes..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">
              Record Payment
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
