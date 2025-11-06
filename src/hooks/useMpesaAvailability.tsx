import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface MpesaAvailabilityResult {
  isAvailable: boolean;
  isChecking: boolean;
  checkAvailability: (invoiceId: string) => Promise<boolean>;
}

export function useMpesaAvailability(): MpesaAvailabilityResult {
  const [isChecking, setIsChecking] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean>(true);

  const checkAvailability = async (invoiceId: string): Promise<boolean> => {
    setIsChecking(true);
    
    try {
      // First, get the lease_id from the invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .select('id, lease_id')
        .eq('id', invoiceId)
        .maybeSingle();

      if (invoiceError) {
        console.error('Error fetching invoice for M-Pesa check:', invoiceError);
        toast.error('Failed to verify M-Pesa availability');
        setIsAvailable(false);
        return false;
      }

      if (!invoice || !invoice.lease_id) {
        console.error('Invoice not found for M-Pesa check');
        toast.error('Invoice not found');
        setIsAvailable(false);
        return false;
      }

      // Get the unit_id from the lease
      const { data: lease, error: leaseError } = await supabase
        .from('leases')
        .select('id, unit_id')
        .eq('id', invoice.lease_id)
        .maybeSingle();

      if (leaseError || !lease) {
        console.error('Error fetching lease for M-Pesa check:', leaseError);
        toast.error('Failed to verify M-Pesa availability');
        setIsAvailable(false);
        return false;
      }

      // Get the property_id from the unit
      const { data: unit, error: unitError } = await supabase
        .from('units')
        .select('id, property_id')
        .eq('id', lease.unit_id)
        .maybeSingle();

      if (unitError || !unit) {
        console.error('Error fetching unit for M-Pesa check:', unitError);
        toast.error('Failed to verify M-Pesa availability');
        setIsAvailable(false);
        return false;
      }

      // Get the landlord_id from the property
      const { data: property, error: propertyError } = await supabase
        .from('properties')
        .select('id, owner_id')
        .eq('id', unit.property_id)
        .maybeSingle();

      if (propertyError || !property) {
        console.error('Error fetching property for M-Pesa check:', propertyError);
        toast.error('Failed to verify M-Pesa availability');
        setIsAvailable(false);
        return false;
      }

      const landlordId = property.owner_id;

      if (!landlordId) {
        console.error('Could not determine landlord for M-Pesa check');
        toast.error('Could not verify M-Pesa availability');
        setIsAvailable(false);
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
        console.error('Error checking M-Pesa config:', configError);
        toast.error('Failed to verify M-Pesa availability');
        setIsAvailable(false);
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
        } else {
          // Platform default is considered available
          available = paymentPrefs?.mpesa_config_preference === 'platform_default';
        }
      }

      setIsAvailable(available);

      if (!available) {
        toast.error(
          'M-Pesa payments are not available for this property yet. Please contact your landlord to enable M-Pesa payments.',
          {
            duration: 5000,
          }
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error checking M-Pesa availability:', error);
      toast.error('Failed to verify M-Pesa availability');
      setIsAvailable(false);
      return false;
    } finally {
      setIsChecking(false);
    }
  };

  return {
    isAvailable,
    isChecking,
    checkAvailability,
  };
}
