import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MpesaPaymentModal } from "./MpesaPaymentModal";
import { MpesaErrorBoundary } from "@/components/mpesa/MpesaErrorBoundary";
import { MoreHorizontal, Smartphone, Download, Eye } from "lucide-react";
import { useMpesaAvailability } from "@/hooks/useMpesaAvailability";

interface TenantInvoiceActionsProps {
  invoice: {
    id: string;
    invoice_number: string;
    amount: number;
    description: string;
    status: string;
  };
  onPaymentSuccess?: () => void;
}

export function TenantInvoiceActions({ invoice, onPaymentSuccess }: TenantInvoiceActionsProps) {
  const [mpesaModalOpen, setMpesaModalOpen] = useState(false);
  const { isChecking, checkAvailability } = useMpesaAvailability();

  const handleDownload = () => {
    // TODO: Implement invoice download functionality
    console.log("Download invoice:", invoice.invoice_number);
  };

  const handleView = () => {
    // TODO: Implement invoice view functionality
    console.log("View invoice:", invoice.invoice_number);
  };

  const handleMpesaPayment = async () => {
    // Check M-Pesa availability before opening the dialog
    const isAvailable = await checkAvailability(invoice.id);
    if (isAvailable) {
      setMpesaModalOpen(true);
    }
  };

  const canPay = invoice.status === 'pending' || invoice.status === 'overdue';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleView}>
            <Eye className="h-4 w-4 mr-2" />
            View Details
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            Download PDF
          </DropdownMenuItem>
          {canPay && (
            <DropdownMenuItem 
              onClick={handleMpesaPayment}
              disabled={isChecking}
              className="text-green-600"
            >
              <Smartphone className="h-4 w-4 mr-2" />
              {isChecking ? 'Checking...' : 'Pay with M-Pesa'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <MpesaErrorBoundary onRetry={() => setMpesaModalOpen(false)}>
        <MpesaPaymentModal
          open={mpesaModalOpen}
          onOpenChange={setMpesaModalOpen}
          invoice={invoice}
          onPaymentInitiated={onPaymentSuccess}
        />
      </MpesaErrorBoundary>
    </>
  );
}