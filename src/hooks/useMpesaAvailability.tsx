import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logger } from '@/utils/logger';

interface MpesaAvailabilityResult {
  isAvailable: boolean;
  isChecking: boolean;
  checkAvailability: (invoiceId: string) => Promise<boolean>;
  error: string | null;
}

type MpesaCheckError = 
  | 'invoice_not_found' 
  | 'lease_not_found' 
  | 'unit_not_found' 
  | 'property_not_found' 
  | 'landlord_not_found'
  | 'config_check_failed'
  | 'network_error'
  | 'unknown_error';

const ERROR_MESSAGES: Record<MpesaCheckError, string> = {
  invoice_not_found: 'Invoice not found. Please refresh and try again.',
  lease_not_found: 'Lease information not found. Please contact support.',
  unit_not_found: 'Unit information not found. Please contact support.',
  property_not_found: 'Property information not found. Please contact support.',
  landlord_not_found: 'Landlord information not found. Please contact support.',
  config_check_failed: 'Unable to verify M-Pesa configuration. Please try again.',
  network_error: 'Network error. Please check your connection and try again.',
  unknown_error: 'An unexpected error occurred. Please try again.',
};

export function useMpesaAvailability(): MpesaAvailabilityResult {
  const [isChecking, setIsChecking] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const handleError = (errorType: MpesaCheckError, details?: string) => {
    const message = ERROR_MESSAGES[errorType];
    setError(message);
    setIsAvailable(false);
    toast.error(message, { duration: 5000 });
    
    logger.error(`M-Pesa availability check failed: ${errorType}`, new Error(message), {
      errorType,
      details
    });
  };

  const checkAvailability = async (invoiceId: string): Promise<boolean> => {
    setIsChecking(true);
    setError(null);
    
    try {
      // First, get the lease_id from the invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .select('id, lease_id')
        .eq('id', invoiceId)
        .maybeSingle();

      if (invoiceError) {
        if (invoiceError.code === 'PGRST116') {
          handleError('invoice_not_found', invoiceId);
        } else if (invoiceError.message?.includes('network') || invoiceError.message?.includes('fetch')) {
          handleError('network_error', invoiceError.message);
        } else {
          handleError('unknown_error', invoiceError.message);
        }
        return false;
      }

      if (!invoice || !invoice.lease_id) {
        handleError('invoice_not_found', invoiceId);
        return false;
      }

      // Get the unit_id from the lease
      const { data: lease, error: leaseError } = await supabase
        .from('leases')
        .select('id, unit_id')
        .eq('id', invoice.lease_id)
        .maybeSingle();

      if (leaseError || !lease) {
        handleError('lease_not_found', leaseError?.message);
        return false;
      }

      // Get the property_id from the unit
      const { data: unit, error: unitError } = await supabase
        .from('units')
        .select('id, property_id')
        .eq('id', lease.unit_id)
        .maybeSingle();

      if (unitError || !unit) {
        handleError('unit_not_found', unitError?.message);
        return false;
      }

      // Get the landlord_id from the property
      const { data: property, error: propertyError } = await supabase
        .from('properties')
        .select('id, owner_id')
        .eq('id', unit.property_id)
        .maybeSingle();

      if (propertyError || !property) {
        handleError('property_not_found', propertyError?.message);
        return false;
      }

      const landlordId = property.owner_id;

      if (!landlordId) {
        handleError('landlord_not_found', 'Property has no owner');
        return false;
      }

      // Check if landlord has M-Pesa configured
      const { data: mpesaConfig, error: configError } = await supabase
        .from('landlord_mpesa_configs')
        .select('id')
        .eq('landlord_id', landlordId)
        .eq('is_active', true)
        .maybeSingle();

      if (configError) {
        handleError('config_check_failed', configError.message);
        return false;
      }

      let available = !!mpesaConfig;

      // If no custom config, check for platform default preference
      if (!available) {
        const { data: paymentPrefs, error: prefsError } = await supabase
          .from('landlord_payment_preferences')
          .select('mpesa_config_preference')
          .eq('landlord_id', landlordId)
          .maybeSingle();

        if (prefsError) {
          console.error('Error checking payment preferences:', prefsError);
        } else if (paymentPrefs?.mpesa_config_preference === 'platform_default') {
          // Explicit platform default preference
          available = true;
        } else if (!paymentPrefs || !paymentPrefs.mpesa_config_preference) {
          // No preference set - default to platform availability for backward compatibility
          console.log('No M-Pesa preference set, defaulting to platform availability');
          available = true;
        }
      }

      setIsAvailable(available);

      if (!available) {
        setError('M-Pesa payments are not available for this property yet.');
        toast.error(
          'M-Pesa payments are not available for this property yet. Please contact your landlord to enable M-Pesa payments.',
          {
            duration: 5000,
          }
        );
        return false;
      }

      logger.info('M-Pesa availability check successful', {
        invoiceId,
        landlordId,
        hasCustomConfig: !!mpesaConfig,
        usesPlatformDefault: available && !mpesaConfig
      });

      return true;
    } catch (error: any) {
      logger.error('Unexpected error checking M-Pesa availability', error);
      handleError('unknown_error', error?.message);
      return false;
    } finally {
      setIsChecking(false);
    }
  };

  return {
    isAvailable,
    isChecking,
    checkAvailability,
    error,
  };
}
