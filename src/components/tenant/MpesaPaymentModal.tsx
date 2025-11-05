import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Smartphone, DollarSign } from "lucide-react";
import { formatAmount, getGlobalCurrencySync } from "@/utils/currency";

interface MpesaPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    invoice_number: string;
    amount: number;
    description: string;
  };
  onPaymentInitiated?: () => void;
}

export function MpesaPaymentModal({ 
  open, 
  onOpenChange, 
  invoice, 
  onPaymentInitiated 
}: MpesaPaymentModalProps) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(false);

  const formatPhoneNumber = (phone: string) => {
    // Remove any non-numeric characters
    let cleaned = phone.replace(/\D/g, '');
    
    // Handle Kenyan numbers
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
      cleaned = '254' + cleaned;
    } else if (!cleaned.startsWith('254')) {
      cleaned = '254' + cleaned;
    }
    
    return cleaned;
  };

  const handlePayment = async () => {
    if (!phoneNumber.trim()) {
      toast.error("Please enter your phone number");
      return;
    }

    setLoading(true);
    try {
      // Pre-flight auth check
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        toast.error("Your session has expired. Please log in again.");
        setLoading(false);
        window.location.href = "/auth";
        return;
      }
      
      // Refresh token if close to expiry (within 5 minutes)
      const expiresAt = session.expires_at;
      const now = Math.floor(Date.now() / 1000);
      if (expiresAt && (expiresAt - now) < 300) {
        console.log('🔄 Refreshing session before M-Pesa payment...');
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) {
          toast.error("Failed to refresh session. Please log in again.");
          setLoading(false);
          return;
        }
      }
      
      const formattedPhone = formatPhoneNumber(phoneNumber);
      
      // Validate phone number format
      if (!/^254[17]\d{8}$/.test(formattedPhone)) {
        toast.error("Please enter a valid Kenyan phone number");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
        body: {
          phone: formattedPhone,
          amount: invoice.amount,
          invoiceId: invoice.id,
          accountReference: invoice.invoice_number,
          transactionDesc: invoice.description || `Payment for ${invoice.invoice_number}`
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success("Payment request sent! Please check your phone and enter your M-Pesa PIN.");
        onPaymentInitiated?.();
        onOpenChange(false);
      } else {
        throw new Error(data?.error || "Failed to initiate payment");
      }
    } catch (error) {
      console.error("Error initiating M-Pesa payment:", error);
      toast.error("Failed to initiate payment. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-green-600" />
            Pay with M-Pesa
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Invoice Details */}
          <Card>
            <CardContent className="pt-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Invoice:</span>
                  <span className="font-medium">{invoice.invoice_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Amount:</span>
                  <span className="font-medium text-lg flex items-center gap-1">
                    <DollarSign className="h-4 w-4" />
                    {formatAmount(invoice.amount)} {getGlobalCurrencySync()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Description:</span>
                  <span className="text-sm">{invoice.description}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Phone Number Input */}
          <div className="space-y-2">
            <Label htmlFor="phone">M-Pesa Phone Number</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="0712345678 or 254712345678"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              Enter your M-Pesa registered phone number
            </p>
          </div>

          {/* Instructions */}
          <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg">
            <h4 className="font-medium text-sm mb-2">Payment Instructions:</h4>
            <ol className="text-xs text-muted-foreground space-y-1">
              <li>1. Enter your M-Pesa phone number above</li>
              <li>2. Click "Send Payment Request"</li>
              <li>3. Check your phone for M-Pesa STK push notification</li>
              <li>4. Enter your M-Pesa PIN to complete payment</li>
            </ol>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              onClick={handlePayment}
              disabled={loading}
              className="flex-1 bg-green-600 hover:bg-green-700"
            >
              {loading ? "Sending..." : "Send Payment Request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}