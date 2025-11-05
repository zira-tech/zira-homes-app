import React, { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Smartphone, CreditCard, Info, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MpesaPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice?: {
    id: string;
    invoice_number: string;
    amount: number;
    tenant_id: string;
  } | null;
  onPaymentInitiated?: () => void;
}

type PaymentStatus = 'idle' | 'sending' | 'sent' | 'verifying' | 'success' | 'error' | 'cancelled';

export const MpesaPaymentDialog: React.FC<MpesaPaymentDialogProps> = ({
  open,
  onOpenChange,
  invoice,
  onPaymentInitiated
}) => {
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [landlordShortcode, setLandlordShortcode] = useState<string | null>(null);
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [checkoutRequestId, setCheckoutRequestId] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Get landlord M-Pesa config info when dialog opens
  useEffect(() => {
    if (open && invoice?.id) {
      const checkLandlordConfig = async () => {
        try {
          const { data } = await supabase.functions.invoke('mpesa-stk-push', {
            body: {
              phone: '254700000000',
              amount: 1,
              invoiceId: invoice.id,
              dryRun: true
            }
          });
          
          if (data?.data?.BusinessShortCode) {
            setLandlordShortcode(data.data.BusinessShortCode);
          }
        } catch (error) {
          console.log('Could not determine landlord shortcode');
        }
      };
      
      checkLandlordConfig();
    }
  }, [open, invoice?.id]);

  const startStatusPolling = useCallback((requestId: string) => {
    let pollCount = 0;
    const maxPolls = 100; // 5 minutes (3s * 100)
    
    setStatus('verifying');
    setStatusMessage('Waiting for payment confirmation...');
    
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    
    pollingIntervalRef.current = setInterval(async () => {
      pollCount++;
      
      try {
        const { data: transaction, error } = await supabase
          .from('mpesa_transactions')
          .select('result_code, result_desc')
          .eq('checkout_request_id', requestId)
          .maybeSingle();
        
        if (transaction) {
          clearInterval(pollingIntervalRef.current!);
          
          if (String(transaction.result_code) === '0') {
            setStatus('success');
            setStatusMessage('Payment completed successfully!');
            
            // Update invoice status
            if (invoice?.id) {
              await supabase
                .from('invoices')
                .update({ 
                  status: 'paid',
                  mpesa_receipt_number: transaction.result_desc 
                })
                .eq('id', invoice.id);
            }
            
            toast({
              title: "Payment Successful",
              description: "Your rent payment has been processed.",
            });
            
            setTimeout(() => {
              onPaymentInitiated?.();
              onOpenChange(false);
              resetDialog();
            }, 2000);
          } else {
            setStatus('error');
            setStatusMessage(transaction.result_desc || 'Payment failed');
            toast({
              title: "Payment Failed",
              description: transaction.result_desc,
              variant: "destructive",
            });
          }
        } else if (pollCount >= maxPolls) {
          clearInterval(pollingIntervalRef.current!);
          setStatus('error');
          setStatusMessage('Payment verification timed out. Please check your payment status.');
          toast({
            title: "Verification Timeout",
            description: "We couldn't verify your payment. Please contact support if money was deducted.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error('Error polling payment status:', error);
      }
    }, 3000);
  }, [invoice, onPaymentInitiated, onOpenChange, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!invoice) {
      toast({
        title: "Error",
        description: "Invoice information is missing",
        variant: "destructive",
      });
      return;
    }
    
    if (!phoneNumber.trim()) {
      toast({
        title: "Error",
        description: "Please enter your phone number",
        variant: "destructive",
      });
      return;
    }

    // Validate phone number format
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length < 9) {
      toast({
        title: "Invalid phone number",
        description: "Please enter a valid Kenyan phone number",
        variant: "destructive",
      });
      return;
    }

    setStatus('sending');
    setStatusMessage('Initiating payment request...');
    setLoading(true);

    try {
      // Pre-flight auth check
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        toast({
          title: "Session Expired",
          description: "Your session has expired. Please log in again.",
          variant: "destructive",
        });
        setStatus('error');
        setStatusMessage('Session expired');
        setLoading(false);
        return;
      }
      
      // Refresh token if close to expiry (within 5 minutes)
      const expiresAt = session.expires_at;
      const now = Math.floor(Date.now() / 1000);
      if (expiresAt && (expiresAt - now) < 300) {
        console.log('🔄 Refreshing session before M-Pesa payment...');
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) {
          toast({
            title: "Session Refresh Failed",
            description: "Failed to refresh session. Please log in again.",
            variant: "destructive",
          });
          setStatus('error');
          setStatusMessage('Session refresh failed');
          setLoading(false);
          return;
        }
      }
      
      const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
        body: {
          phone: phoneNumber,
          amount: invoice.amount,
          accountReference: invoice.invoice_number,
          transactionDesc: `Rent payment for ${invoice.invoice_number}`,
          invoiceId: invoice.id,
          paymentType: 'rent'
        }
      });

      if (error) {
        console.error('STK push error:', error);
        
        // Parse error for specific error IDs
        let errorMessage = 'Failed to initiate payment';
        const errorStr = error.message || JSON.stringify(error);
        
        if (errorStr.includes('AUTH_INVALID_JWT')) {
          errorMessage = 'Your session has expired. Please log in again.';
        } else if (errorStr.includes('AUTH_NOT_AUTHORIZED')) {
          errorMessage = 'You are not authorized to make this payment.';
        } else if (errorStr.includes('AUTH_INVOICE_NOT_FOUND')) {
          errorMessage = 'Invoice not found. Please refresh and try again.';
        } else if (errorStr.includes('MPESA_CONFIG_MISSING')) {
          errorMessage = 'M-Pesa is not configured for this property. Please contact your landlord.';
        } else if (error.message) {
          errorMessage = error.message;
        }
        
        setStatus('error');
        setStatusMessage(errorMessage);
        toast({
          title: "Payment Failed",
          description: errorMessage,
          variant: "destructive",
        });
        return;
      }
      
      if (data?.CheckoutRequestID) {
        setCheckoutRequestId(data.CheckoutRequestID);
        setStatus('sent');
        setStatusMessage('Check your phone for the M-Pesa prompt and enter your PIN');
        
        toast({
          title: "Payment Request Sent",
          description: "Please check your phone for the M-Pesa prompt",
        });
        
        // Start polling for payment status
        startStatusPolling(data.CheckoutRequestID);
      } else if (data?.success) {
        // Fallback for old response format
        toast({
          title: "Payment Request Sent",
          description: "STK push sent. Please check your phone.",
        });
        
        onPaymentInitiated?.();
        onOpenChange(false);
        resetDialog();
      } else {
        throw new Error(data?.error || 'Payment request failed');
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      setStatus('error');
      setStatusMessage(error.message || 'An unexpected error occurred');
      toast({
        title: "Payment Error",
        description: "Failed to process payment request",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const resetDialog = () => {
    setStatus('idle');
    setStatusMessage('');
    setCheckoutRequestId(null);
    setPhoneNumber('');
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
  };

  const handleClose = () => {
    resetDialog();
    onOpenChange(false);
  };

  const handleRetry = () => {
    resetDialog();
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'sending':
        return <Loader2 className="h-6 w-6 animate-spin text-blue-500" />;
      case 'sent':
        return <Smartphone className="h-6 w-6 animate-pulse text-orange-500" />;
      case 'verifying':
        return <Clock className="h-6 w-6 animate-pulse text-blue-500" />;
      case 'success':
        return <CheckCircle2 className="h-6 w-6 text-green-500" />;
      case 'error':
        return <XCircle className="h-6 w-6 text-red-500" />;
      case 'cancelled':
        return <AlertCircle className="h-6 w-6 text-gray-500" />;
      default:
        return <Smartphone className="h-6 w-6 text-primary" />;
    }
  };

  useEffect(() => {
    if (!open) {
      resetDialog();
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-green-600" />
            M-Pesa Payment
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Payment info */}
          {invoice && (
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Invoice:</span>
                <span className="text-sm font-medium">{invoice.invoice_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Amount:</span>
                <span className="text-sm font-medium">KES {invoice.amount.toLocaleString()}</span>
              </div>
              {landlordShortcode && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Paybill/Till:</span>
                  <span className="text-sm font-medium">{landlordShortcode}</span>
                </div>
              )}
            </div>
          )}

          {/* Status alert */}
          {status !== 'idle' && (
            <Alert className={cn(
              "mt-4",
              status === 'success' && "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950",
              status === 'error' && "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950",
              status === 'sent' && "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950",
              status === 'verifying' && "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950"
            )}>
              <div className="flex items-center gap-3">
                {getStatusIcon()}
                <div className="flex-1">
                  <AlertTitle className="mb-1">
                    {status === 'sending' && 'Processing...'}
                    {status === 'sent' && 'Check Your Phone'}
                    {status === 'verifying' && 'Verifying Payment...'}
                    {status === 'success' && 'Payment Successful!'}
                    {status === 'error' && 'Payment Failed'}
                  </AlertTitle>
                  <AlertDescription>{statusMessage}</AlertDescription>
                </div>
              </div>
            </Alert>
          )}

          {/* Info alert for idle state */}
          {status === 'idle' && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  <p>You'll receive an STK push notification on your phone to complete the payment.</p>
                </div>
              </div>
            </div>
          )}

          {/* Phone number input - only show in idle state */}
          {status === 'idle' && (
            <div className="space-y-2">
              <Label htmlFor="phone">M-Pesa Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="e.g., 0701234567"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Enter the phone number registered with M-Pesa
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-4">
            {status === 'idle' && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  disabled={loading}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !phoneNumber}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <CreditCard className="h-4 w-4 mr-2" />
                      Pay Now
                    </>
                  )}
                </Button>
              </>
            )}

            {(status === 'sent' || status === 'verifying') && (
              <Button type="button" variant="outline" onClick={handleClose} className="flex-1">
                Cancel
              </Button>
            )}

            {status === 'success' && (
              <Button onClick={handleClose} className="flex-1">
                Close
              </Button>
            )}

            {status === 'error' && (
              <>
                <Button type="button" variant="outline" onClick={handleClose} className="flex-1">
                  Close
                </Button>
                <Button onClick={handleRetry} className="flex-1">
                  Try Again
                </Button>
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
