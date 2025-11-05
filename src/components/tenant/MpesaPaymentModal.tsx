import { useState, useCallback, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Smartphone, DollarSign, Loader2, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { formatAmount, getGlobalCurrencySync } from "@/utils/currency";
import { cn } from "@/lib/utils";

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

type PaymentStatus = 'idle' | 'sending' | 'sent' | 'verifying' | 'success' | 'error' | 'cancelled';

export function MpesaPaymentModal({ 
  open, 
  onOpenChange, 
  invoice, 
  onPaymentInitiated 
}: MpesaPaymentModalProps) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [checkoutRequestId, setCheckoutRequestId] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const formatPhoneNumber = (phone: string) => {
    let cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
      cleaned = '254' + cleaned;
    } else if (!cleaned.startsWith('254')) {
      cleaned = '254' + cleaned;
    }
    
    return cleaned;
  };

  const startStatusPolling = useCallback((requestId: string) => {
    let pollCount = 0;
    const maxPolls = 100;
    
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
            await supabase
              .from('invoices')
              .update({ 
                status: 'paid',
                mpesa_receipt_number: transaction.result_desc 
              })
              .eq('id', invoice.id);
            
            toast.success("Payment successful!");
            
            setTimeout(() => {
              onPaymentInitiated?.();
              onOpenChange(false);
              resetDialog();
            }, 2000);
          } else {
            setStatus('error');
            setStatusMessage(transaction.result_desc || 'Payment failed');
            toast.error(transaction.result_desc || 'Payment failed');
          }
        } else if (pollCount >= maxPolls) {
          clearInterval(pollingIntervalRef.current!);
          setStatus('error');
          setStatusMessage('Payment verification timed out. Please check your payment status.');
          toast.error("Payment verification timed out. Please contact support if money was deducted.");
        }
      } catch (error) {
        console.error('Error polling payment status:', error);
      }
    }, 3000);
  }, [invoice, onPaymentInitiated, onOpenChange]);

  const handlePayment = async () => {
    if (!phoneNumber.trim()) {
      toast.error("Please enter your phone number");
      return;
    }

    setStatus('sending');
    setStatusMessage('Initiating payment request...');
    setLoading(true);
    
    try {
      // Pre-flight auth check
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        toast.error("Your session has expired. Please log in again.");
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
          toast.error("Failed to refresh session. Please log in again.");
          setStatus('error');
          setStatusMessage('Session refresh failed');
          setLoading(false);
          return;
        }
      }
      
      const formattedPhone = formatPhoneNumber(phoneNumber);
      
      // Validate phone number format
      if (!/^254[17]\d{8}$/.test(formattedPhone)) {
        toast.error("Please enter a valid Kenyan phone number");
        setStatus('error');
        setStatusMessage('Invalid phone number');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
        body: {
          phone: formattedPhone,
          amount: invoice.amount,
          invoiceId: invoice.id,
          accountReference: invoice.invoice_number,
          transactionDesc: invoice.description || `Payment for ${invoice.invoice_number}`,
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
        toast.error(errorMessage);
        return;
      }

      if (data?.CheckoutRequestID) {
        setCheckoutRequestId(data.CheckoutRequestID);
        setStatus('sent');
        setStatusMessage('Check your phone for the M-Pesa prompt and enter your PIN');
        
        toast.success("Payment request sent! Check your phone.");
        
        // Start polling for payment status
        startStatusPolling(data.CheckoutRequestID);
      } else if (data?.success) {
        toast.success("Payment request sent! Please check your phone and enter your M-Pesa PIN.");
        onPaymentInitiated?.();
        onOpenChange(false);
        resetDialog();
      } else {
        throw new Error(data?.error || "Failed to initiate payment");
      }
    } catch (error: any) {
      console.error("Error initiating M-Pesa payment:", error);
      setStatus('error');
      setStatusMessage(error.message || 'An unexpected error occurred');
      toast.error("Failed to initiate payment. Please try again.");
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

          {/* Status alert */}
          {status !== 'idle' && (
            <Alert className={cn(
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

          {/* Phone Number Input - only show in idle state */}
          {status === 'idle' && (
            <>
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
            </>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            {status === 'idle' && (
              <>
                <Button 
                  variant="outline" 
                  onClick={handleClose}
                  disabled={loading}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handlePayment}
                  disabled={loading || !phoneNumber}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Sending...
                    </>
                  ) : (
                    "Send Payment Request"
                  )}
                </Button>
              </>
            )}

            {(status === 'sent' || status === 'verifying') && (
              <Button variant="outline" onClick={handleClose} className="flex-1">
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
                <Button variant="outline" onClick={handleClose} className="flex-1">
                  Close
                </Button>
                <Button onClick={handleRetry} className="flex-1">
                  Try Again
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
