import { supabase } from "@/integrations/supabase/client";

export interface BillFromData {
  name: string;
  companyName?: string;
  address: string;
  phone: string;
  email: string;
}

export interface BillingData {
  billFrom: BillFromData;
  billTo: {
    name: string;
    address: string;
  };
}

/**
 * Fetches landlord billing data for an invoice based on the property owner
 * Returns structured billFrom data for PDF generation
 */
export async function getLandlordBillingData(invoice: any): Promise<BillFromData> {
  try {
    // Try to get owner_id from invoice's lease -> unit -> property relationship
    let ownerId: string | null = null;
    
    // Check if owner info is already in the invoice data
    if (invoice?.leases?.units?.properties?.owner_id) {
      ownerId = invoice.leases.units.properties.owner_id;
    } else if (invoice?.lease_id) {
      // Step 1: Get unit_id from lease
      const { data: leaseData, error: leaseError } = await supabase
        .from('leases')
        .select('unit_id')
        .eq('id', invoice.lease_id)
        .single();
      
      if (leaseError || !leaseData?.unit_id) {
        console.warn('Could not fetch lease unit:', leaseError?.message);
        return getDefaultBillFrom();
      }
      
      // Step 2: Get property_id from unit
      const { data: unitData, error: unitError } = await supabase
        .from('units')
        .select('property_id')
        .eq('id', leaseData.unit_id)
        .single();
      
      if (unitError || !unitData?.property_id) {
        console.warn('Could not fetch unit property:', unitError?.message);
        return getDefaultBillFrom();
      }
      
      // Step 3: Get owner_id from property
      const { data: propertyData, error: propertyError } = await supabase
        .from('properties')
        .select('owner_id')
        .eq('id', unitData.property_id)
        .single();
      
      if (!propertyError && propertyData?.owner_id) {
        ownerId = propertyData.owner_id;
      }
    }

    if (!ownerId) {
      console.warn('Could not determine property owner for invoice:', invoice.id);
      return getDefaultBillFrom();
    }

    // Fetch landlord profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('first_name, last_name, email, phone')
      .eq('id', ownerId)
      .single();

    if (profileError || !profile) {
      console.warn('Could not fetch landlord profile:', profileError?.message);
      return getDefaultBillFrom();
    }

    // Build landlord name
    const landlordName = [profile.first_name, profile.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || 'Property Manager';

    return {
      name: landlordName,
      companyName: undefined,
      address: 'Property Management Office',
      phone: profile.phone || 'Phone not available',
      email: profile.email || 'Email not available'
    };
  } catch (error) {
    console.error('Error fetching landlord billing data:', error);
    return getDefaultBillFrom();
  }
}

/**
 * Creates complete billing data object with both billFrom and billTo
 */
export async function getInvoiceBillingData(invoice: any): Promise<BillingData> {
  const billFrom = await getLandlordBillingData(invoice);
  
  // Extract tenant/property info for billTo
  const tenantName = invoice.tenants 
    ? `${invoice.tenants.first_name || ''} ${invoice.tenants.last_name || ''}`.trim() 
    : 'Tenant';
  
  const propertyName = invoice.leases?.units?.properties?.name || 'Property';
  const unitNumber = invoice.leases?.units?.unit_number || 'N/A';
  
  return {
    billFrom,
    billTo: {
      name: tenantName || 'Tenant',
      address: `${propertyName}\nUnit: ${unitNumber}`
    }
  };
}

/**
 * Default fallback billing data when landlord info unavailable
 */
function getDefaultBillFrom(): BillFromData {
  return {
    name: 'Property Management',
    address: 'Address not available',
    phone: 'Phone not available',
    email: 'Email not available'
  };
}
