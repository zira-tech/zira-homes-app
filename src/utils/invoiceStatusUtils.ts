export type InvoiceStatus = 'pending' | 'unpaid' | 'overdue' | 'paid' | 'cancelled';

/**
 * Check if an invoice can be paid by the tenant
 */
export const isInvoicePayable = (status: string): boolean => {
  return ['pending', 'unpaid', 'overdue'].includes(status);
};

/**
 * Get the card gradient class for an invoice status
 */
export const getInvoiceCardClass = (status: string): string => {
  if (status === 'overdue') return 'card-gradient-red';
  if (status === 'pending' || status === 'unpaid') return 'card-gradient-orange';
  return 'card-gradient-green';
};

/**
 * Check if status indicates an outstanding balance
 */
export const isInvoiceOutstanding = (status: string): boolean => {
  return ['pending', 'unpaid', 'overdue'].includes(status);
};
