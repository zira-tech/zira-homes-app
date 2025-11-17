import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logger } from '@/utils/logger';

interface MpesaCheckDiagnostics {
  invoiceId?: string;
  leaseId?: string;
  unitId?: string;
  propertyId?: string;
  landlordId?: string;
  hasCustomConfig?: boolean;
  usesPlatformDefault?: boolean;
  step?: string;
}

interface MpesaAvailabilityResult {
  isAvailable: boolean;
  isChecking: boolean;
  checkAvailability: (invoiceId: string) => Promise<boolean>;
  error: string | null;
  lastErrorType: MpesaCheckError | null;
  lastErrorDetails: string | null;
  lastCheck: MpesaCheckDiagnostics | null;
}

type MpesaCheckError = 
  | 'invoice_not_found' 
  | 'lease_not_found' 
  | 'unit_not_found' 
  | 'property_not_found' 
  | 'landlord_not_found'
  | 'no_mpesa_config'
  | 'credentials_not_verified'
  | 'config_inactive'
  | 'payment_preference_check_failed'
  | 'config_check_failed'
  | 'network_error'
  | 'unknown_error';

const ERROR_MESSAGES: Record<MpesaCheckError, string> = {
  invoice_not_found: 'Invoice not found. Please refresh and try again.',
  lease_not_found: 'Lease information not found. Please contact support.',
  unit_not_found: 'Unit information not found. Please contact support.',
  property_not_found: 'Property information not found. Please contact support.',
  landlord_not_found: 'Landlord information not found. Please contact support.',
  no_mpesa_config: 'M-Pesa payment not configured for this property',
  credentials_not_verified: 'M-Pesa credentials require verification',
  config_inactive: 'M-Pesa configuration is inactive',
  payment_preference_check_failed: 'Unable to verify payment preferences',
  config_check_failed: 'Unable to verify M-Pesa configuration. Please try again.',
  network_error: 'Network error. Please check your connection and try again.',
  unknown_error: 'An unexpected error occurred. Please try again.',
};

export function useMpesaAvailability(): MpesaAvailabilityResult {
  const [isChecking, setIsChecking] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastErrorType, setLastErrorType] = useState<MpesaCheckError | null>(null);
  const [lastErrorDetails, setLastErrorDetails] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<MpesaCheckDiagnostics | null>(null);

  const handleError = (errorType: MpesaCheckError, details?: string, diagnosticData?: MpesaCheckDiagnostics) => {
    const timestamp = new Date().toISOString();
    const message = ERROR_MESSAGES[errorType];
    
    console.group('🔴 M-Pesa Availability Check Failed');
    console.error('Error Type:', errorType);
    console.error('Message:', message);
    console.error('Details:', details);
    console.error('Timestamp:', timestamp);
    console.error('Diagnostic Data:', diagnosticData);
    console.groupEnd();
    
    setError(message);
    setLastErrorType(errorType);
    setLastErrorDetails(details || null);
    setIsAvailable(false);
    toast.error(`${message} (Last checked: ${new Date().toLocaleTimeString()})`, { duration: 5000 });
    
    logger.error(`M-Pesa availability check failed: ${errorType}`, new Error(message), {
      errorType,
      details,
      timestamp,
      diagnosticData
    });
  };

  const checkAvailability = async (invoiceId: string): Promise<boolean> => {
    const checkStartTime = Date.now();
    const timestamp = new Date().toISOString();
    
    console.group('🔍 M-Pesa Availability Check Started');
    console.log('Invoice ID:', invoiceId);
    console.log('Timestamp:', timestamp);
    console.groupEnd();
    
    setIsChecking(true);
    setError(null);
    setLastErrorType(null);
    setLastErrorDetails(null);
    
    const diagnostics: MpesaCheckDiagnostics = { invoiceId, step: 'initialized' };
    setLastCheck(diagnostics);
    
    // Debug bypass flag - still log issues but allow modal to open
    const debugBypass = import.meta.env.VITE_MPESA_DEBUG_BYPASS_CHECK === 'true';
    
    try {
      // First, get the lease_id from the invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .select('id, lease_id')
        .eq('id', invoiceId)
        .maybeSingle();

      if (invoiceError) {
        console.error('❌ [M-Pesa Availability] Invoice query error:', invoiceError);
        diagnostics.step = 'invoice_error';
        setLastCheck(diagnostics);
        
        if (invoiceError.code === 'PGRST116') {
          handleError('invoice_not_found', invoiceId, diagnostics);
        } else if (invoiceError.message?.includes('network') || invoiceError.message?.includes('fetch')) {
          handleError('network_error', invoiceError.message, diagnostics);
        } else if (invoiceError.code === 'PGRST301' || invoiceError.message?.includes('permission')) {
          handleError('config_check_failed', `RLS/Permission error accessing invoice: ${invoiceError.message}`, diagnostics);
        } else {
          handleError('unknown_error', invoiceError.message, diagnostics);
        }
        return debugBypass;
      }

      if (!invoice || !invoice.lease_id) {
        console.error('❌ [M-Pesa Availability] Invoice not found or missing lease_id');
        diagnostics.step = 'invoice_missing';
        setLastCheck(diagnostics);
        handleError('invoice_not_found', invoiceId, diagnostics);
        return debugBypass;
      }
      
      console.log('✅ [M-Pesa Availability] Invoice found:', { id: invoice.id, lease_id: invoice.lease_id });
      diagnostics.leaseId = invoice.lease_id;
      diagnostics.step = 'fetching_lease';

      // Get the unit_id from the lease
      const { data: lease, error: leaseError } = await supabase
        .from('leases')
        .select('id, unit_id')
        .eq('id', invoice.lease_id)
        .maybeSingle();

      if (leaseError || !lease) {
        console.error('❌ [M-Pesa Availability] Lease query error:', leaseError);
        diagnostics.step = 'lease_error';
        setLastCheck(diagnostics);
        
        if (leaseError?.code === 'PGRST301' || leaseError?.message?.includes('permission')) {
          handleError('config_check_failed', `RLS/Permission error accessing lease: ${leaseError.message}`, diagnostics);
        } else {
          handleError('lease_not_found', leaseError?.message, diagnostics);
        }
        return debugBypass;
      }
      
      console.log('✅ [M-Pesa Availability] Lease found:', { id: lease.id, unit_id: lease.unit_id });
      diagnostics.unitId = lease.unit_id;
      diagnostics.step = 'fetching_unit';

      // Get the property_id from the unit
      const { data: unit, error: unitError } = await supabase
        .from('units')
        .select('id, property_id')
        .eq('id', lease.unit_id)
        .maybeSingle();

      if (unitError || !unit) {
        console.error('❌ [M-Pesa Availability] Unit query error:', unitError);
        diagnostics.step = 'unit_error';
        setLastCheck(diagnostics);
        
        if (unitError?.code === 'PGRST301' || unitError?.message?.includes('permission')) {
          handleError('config_check_failed', `RLS/Permission error accessing unit: ${unitError.message}`, diagnostics);
        } else {
          handleError('unit_not_found', unitError?.message, diagnostics);
        }
        return debugBypass;
      }
      
      console.log('✅ [M-Pesa Availability] Unit found:', { id: unit.id, property_id: unit.property_id });
      diagnostics.propertyId = unit.property_id;
      diagnostics.step = 'fetching_property';

      // Get the landlord_id from the property
      const { data: property, error: propertyError } = await supabase
        .from('properties')
        .select('id, owner_id')
        .eq('id', unit.property_id)
        .maybeSingle();

      if (propertyError || !property) {
        console.error('❌ [M-Pesa Availability] Property query error:', propertyError);
        diagnostics.step = 'property_error';
        setLastCheck(diagnostics);
        
        if (propertyError?.code === 'PGRST301' || propertyError?.message?.includes('permission')) {
          handleError('config_check_failed', `RLS/Permission error accessing property: ${propertyError.message}`, diagnostics);
        } else {
          handleError('property_not_found', propertyError?.message, diagnostics);
        }
        return debugBypass;
      }

      const landlordId = property.owner_id;

      if (!landlordId) {
        console.error('❌ [M-Pesa Availability] Property has no owner_id');
        diagnostics.step = 'landlord_missing';
        setLastCheck(diagnostics);
        handleError('landlord_not_found', 'Property has no owner', diagnostics);
        return debugBypass;
      }
      
      console.log('✅ [M-Pesa Availability] Property found with owner:', { property_id: property.id, landlord_id: landlordId });
      diagnostics.landlordId = landlordId;
      diagnostics.step = 'checking_mpesa_config';

      // Check if landlord has M-Pesa configured
      console.log('🔍 [M-Pesa Availability] Checking landlord M-Pesa config for landlord:', landlordId);
      
      // First check if ANY config exists (active or inactive) to provide better error messages
      const { data: allConfigs, error: allConfigsError } = await supabase
        .from('landlord_mpesa_configs')
        .select('id, business_shortcode, is_active, credentials_verified, shortcode_type')
        .eq('landlord_id', landlordId);

      if (allConfigsError) {
        console.error('❌ [M-Pesa Availability] Config query error:', allConfigsError);
        diagnostics.step = 'config_query_error';
        setLastCheck(diagnostics);
        
        if (allConfigsError.code === 'PGRST301' || allConfigsError.message?.includes('permission')) {
          handleError('config_check_failed', `RLS/Permission error accessing M-Pesa config: ${allConfigsError.message}`, diagnostics);
        } else {
          handleError('config_check_failed', allConfigsError.message, diagnostics);
        }
        return debugBypass;
      }

      // Now check for active config
      const { data: mpesaConfig, error: configError } = await supabase
        .from('landlord_mpesa_configs')
        .select('id, business_shortcode, is_active, credentials_verified, shortcode_type')
        .eq('landlord_id', landlordId)
        .eq('is_active', true)
        .maybeSingle();

      if (configError) {
        console.error('❌ [M-Pesa Availability] Active config query error:', configError);
        diagnostics.step = 'config_query_error';
        setLastCheck(diagnostics);
        
        if (configError.code === 'PGRST301' || configError.message?.includes('permission')) {
          handleError('config_check_failed', `RLS/Permission error accessing M-Pesa config: ${configError.message}`, diagnostics);
        } else {
          handleError('config_check_failed', configError.message, diagnostics);
        }
        return debugBypass;
      }

      let available = !!mpesaConfig;
      diagnostics.hasCustomConfig = available;
      
      // Enhanced error handling for no active config
      if (!mpesaConfig) {
        console.warn('⚠️ [M-Pesa Availability] No active M-Pesa config found');
        
        // Check if there are inactive configs
        const inactiveConfigs = allConfigs?.filter(c => !c.is_active) || [];
        const verifiedInactive = inactiveConfigs.find(c => c.credentials_verified);
        
        if (verifiedInactive) {
          console.warn('⚠️ [M-Pesa Availability] Found verified but inactive config:', {
            id: verifiedInactive.id,
            type: verifiedInactive.shortcode_type,
            shortcode: verifiedInactive.business_shortcode
          });
          diagnostics.step = 'config_inactive';
          setLastCheck(diagnostics);
          handleError(
            'config_inactive',
            `M-Pesa config exists and is verified but inactive (${verifiedInactive.shortcode_type} ${verifiedInactive.business_shortcode}). Please activate it in payment settings.`,
            diagnostics
          );
          return debugBypass;
        }
        
        if (inactiveConfigs.length > 0) {
          console.warn('⚠️ [M-Pesa Availability] Found inactive unverified configs:', inactiveConfigs.length);
          diagnostics.step = 'config_inactive_unverified';
          setLastCheck(diagnostics);
          handleError(
            'config_inactive',
            `M-Pesa config exists but is inactive and unverified. Please verify and activate in payment settings.`,
            diagnostics
          );
          return debugBypass;
        }
        
        // No configs at all - check for platform default preference
        diagnostics.step = 'checking_platform_preference';
      } else if (!mpesaConfig.credentials_verified) {
        console.warn('⚠️ [M-Pesa Availability] M-Pesa config is active but credentials not verified:', {
          id: mpesaConfig.id,
          type: mpesaConfig.shortcode_type,
          shortcode: mpesaConfig.business_shortcode
        });
        diagnostics.step = 'credentials_not_verified';
        setLastCheck(diagnostics);
        handleError(
          'credentials_not_verified',
          `M-Pesa config (${mpesaConfig.shortcode_type} ${mpesaConfig.business_shortcode}) is active but credentials have not been verified. Please test credentials in payment settings.`,
          diagnostics
        );
        return debugBypass;
      } else {
        console.log('✅ [M-Pesa Availability] Valid M-Pesa config found:', {
          id: mpesaConfig.id,
          type: mpesaConfig.shortcode_type,
          shortcode: mpesaConfig.business_shortcode,
          verified: mpesaConfig.credentials_verified
        });
        diagnostics.step = 'config_verified';
      }

      diagnostics.step = 'checking_platform_preference';

      // If no custom config, check for platform default preference
      if (!available) {
        const { data: paymentPrefs, error: prefsError } = await supabase
          .from('landlord_payment_preferences')
          .select('mpesa_config_preference')
          .eq('landlord_id', landlordId)
          .maybeSingle();

        if (prefsError) {
          console.error('⚠️ [M-Pesa Availability] Error checking payment preferences:', prefsError);
          diagnostics.step = 'payment_prefs_error';
          setLastCheck(diagnostics);
          handleError('payment_preference_check_failed', prefsError.message, diagnostics);
          return debugBypass;
        } else if (paymentPrefs?.mpesa_config_preference === 'platform_default') {
          // Explicit platform default preference
          console.log('✅ [M-Pesa Availability] Using platform default (explicit preference)');
          available = true;
          diagnostics.usesPlatformDefault = true;
        } else if (!paymentPrefs || !paymentPrefs.mpesa_config_preference) {
          // No preference set - default to platform availability for backward compatibility
          console.log('✅ [M-Pesa Availability] No preference set, defaulting to platform availability');
          available = true;
          diagnostics.usesPlatformDefault = true;
        } else {
          // Preference set to custom but no config found
          console.error('❌ [M-Pesa Availability] Payment preference is custom but no valid config');
          diagnostics.step = 'no_config_custom_preference';
          setLastCheck(diagnostics);
          handleError('no_mpesa_config', 'M-Pesa not configured. Please set up M-Pesa in payment settings.', diagnostics);
          return debugBypass;
        }
      }

      diagnostics.step = 'complete';
      setLastCheck(diagnostics);
      setIsAvailable(available);

      if (!available) {
        console.error('❌ [M-Pesa Availability] M-Pesa not available for this property');
        setError('M-Pesa payments are not available for this property yet.');
        setLastErrorType('config_check_failed');
        setLastErrorDetails('No active M-Pesa configuration found for landlord');
        
        if (!debugBypass) {
          toast.error(
            'M-Pesa payments are not available for this property yet. Please contact your landlord to enable M-Pesa payments.',
            {
              duration: 5000,
            }
          );
        }
        return debugBypass;
      }

      console.log('✅ [M-Pesa Availability] Check successful:', {
        invoiceId,
        landlordId,
        hasCustomConfig: !!mpesaConfig,
        usesPlatformDefault: available && !mpesaConfig
      });

      logger.info('M-Pesa availability check successful', {
        invoiceId,
        landlordId,
        hasCustomConfig: !!mpesaConfig,
        usesPlatformDefault: available && !mpesaConfig
      });

      return true;
    } catch (error: any) {
      console.error('💥 [M-Pesa Availability] Unexpected error:', error);
      diagnostics.step = 'exception';
      setLastCheck(diagnostics);
      logger.error('Unexpected error checking M-Pesa availability', error);
      handleError('unknown_error', error?.message, diagnostics);
      return debugBypass;
    } finally {
      setIsChecking(false);
      const checkDuration = Date.now() - checkStartTime;
      
      console.group('✅ M-Pesa Availability Check Completed');
      console.log('Duration:', `${checkDuration}ms`);
      console.log('Result:', isAvailable ? 'Available' : 'Not Available');
      console.log('Final Diagnostics:', diagnostics);
      console.groupEnd();
    }
  };

  return {
    isAvailable,
    isChecking,
    checkAvailability,
    error,
    lastErrorType,
    lastErrorDetails,
    lastCheck,
  };
}
