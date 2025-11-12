import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 🔖 VERSION: 2025-11-12-v2.2 - Enhanced pending transaction lookup by reference
  console.log('🚀 kopokopo-callback VERSION: 2025-11-12-v2.2 (reference-based reconciliation)');
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== KOPO KOPO CALLBACK RECEIVED ===');
    console.log('Request method:', req.method);
    console.log('Request headers:', JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2));

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse callback data
    const callbackData = await req.json();
    console.log('Callback data:', JSON.stringify(callbackData, null, 2));

    // Extract data from Kopo Kopo callback structure
    const attributes = callbackData?.data?.attributes;
    if (!attributes) {
      console.error('❌ Invalid callback structure - missing data.attributes');
      return new Response(
        JSON.stringify({ error: 'Invalid callback structure' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const event = attributes.event || {};
    const resource = event.resource || {};
    const metadata = attributes.metadata || {};
    const status = attributes.status; // 'Success' or 'Failed'

    // Extract payment details
    const transactionId = resource.id || '';
    const reference = metadata.reference || '';
    const phoneNumber = resource.sender_phone_number || '';
    const amount = parseFloat(resource.amount || '0');
    const senderFirstName = resource.sender_first_name || '';
    const senderLastName = resource.sender_last_name || '';
    const invoiceId = metadata.invoice_id || '';
    const paymentType = metadata.payment_type || 'rent';
    const landlordId = metadata.landlord_id || '';

    console.log('📊 Payment Details:');
    console.log(`   Status: ${status}`);
    console.log(`   Reference: ${reference}`);
    console.log(`   Transaction ID: ${transactionId}`);
    console.log(`   Phone: ${phoneNumber}`);
    console.log(`   Amount: ${amount}`);
    console.log(`   Invoice ID: ${invoiceId}`);
    console.log(`   Payment Type: ${paymentType}`);

    // Determine final status
    const finalStatus = status?.toLowerCase() === 'success' ? 'completed' : 'failed';
    const resultCode = status?.toLowerCase() === 'success' ? 0 : 1;
    const resultDesc = status?.toLowerCase() === 'success' ? 'Payment successful' : (attributes.failure_reason || 'Payment failed');

    // Check if we should update existing transaction or insert new one
    // Priority 1: Look for pending transaction by metadata.reference (most reliable)
    let existingTxn = null;
    
    if (reference) {
      const { data } = await supabase
        .from('mpesa_transactions')
        .select('*')
        .eq('status', 'pending')
        .or(`metadata->reference.eq.${reference}`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      existingTxn = data;
      console.log('🔍 Lookup by reference:', { reference, found: !!existingTxn });
    }
    
    // Priority 2: Fallback to phone + amount match if reference lookup failed
    if (!existingTxn && phoneNumber && amount) {
      const { data } = await supabase
        .from('mpesa_transactions')
        .select('*')
        .eq('phone_number', phoneNumber)
        .eq('amount', amount)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      existingTxn = data;
      console.log('🔍 Fallback lookup by phone+amount:', { phoneNumber, amount, found: !!existingTxn });
    }
    
    // Check idempotency - if this exact transaction was already processed
    if (!existingTxn && transactionId) {
      const { data: completedTxn } = await supabase
        .from('mpesa_transactions')
        .select('*')
        .eq('mpesa_receipt_number', transactionId)
        .maybeSingle();
      
      if (completedTxn) {
        console.log('⚠️ Transaction already processed:', transactionId);
        return new Response(
          JSON.stringify({ status: 'ok', message: 'Already processed' }), 
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (existingTxn) {
      // Update existing pending transaction
      console.log('📝 Updating existing transaction:', existingTxn.id);
      const { error: updateError } = await supabase
        .from('mpesa_transactions')
        .update({
          result_code: resultCode,
          result_desc: resultDesc,
          mpesa_receipt_number: transactionId,
          phone_number: phoneNumber || existingTxn.phone_number,
          amount: amount || existingTxn.amount,
          status: finalStatus,
          metadata: {
            ...existingTxn.metadata,
            provider: 'kopokopo',
            callback_reference: reference,
            transaction_id: transactionId,
            sender_first_name: senderFirstName,
            sender_last_name: senderLastName,
            raw_callback: callbackData
          }
        })
        .eq('id', existingTxn.id);

      if (updateError) {
        console.error('❌ Failed to update transaction:', updateError);
      } else {
        console.log('✅ Transaction updated successfully');
      }
    } else {
      // Insert new transaction record with unique checkout_request_id to avoid conflicts
      console.log('💾 Inserting new transaction record (no pending match found)...');
      const uniqueCheckoutId = `kk_cb_${transactionId || Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      
      const { error: transactionError } = await supabase
        .from('mpesa_transactions')
        .insert({
          merchant_request_id: reference || uniqueCheckoutId,
          checkout_request_id: uniqueCheckoutId,
          result_code: resultCode,
          result_desc: resultDesc,
          mpesa_receipt_number: transactionId,
          phone_number: phoneNumber,
          amount: amount,
          status: finalStatus,
          invoice_id: invoiceId || null,
          payment_type: paymentType || 'rent',
          metadata: {
            provider: 'kopokopo',
            reference: reference,
            transaction_id: transactionId,
            landlord_id: landlordId,
            sender_first_name: senderFirstName,
            sender_last_name: senderLastName,
            raw_callback: callbackData,
            note: 'Created from callback (no pending transaction found)'
          }
        });

      if (transactionError) {
        console.error('❌ Failed to insert transaction:', transactionError);
      } else {
        console.log('✅ Transaction record inserted with unique ID:', uniqueCheckoutId);
      }
    }

    // If successful, update invoice and create payment record
    if (finalStatus === 'completed' && invoiceId) {
      console.log(`📝 Processing successful payment for invoice ${invoiceId}`);

      // Update invoice status
      const { error: invoiceError } = await supabase
        .from('invoices')
        .update({ 
          status: 'paid',
          payment_date: new Date().toISOString()
        })
        .eq('id', invoiceId);

      if (invoiceError) {
        console.error('❌ Failed to update invoice:', invoiceError);
      } else {
        console.log('✅ Invoice status updated to paid');
      }

      // Get invoice details for payment record
      const { data: invoice } = await supabase
        .from('invoices')
        .select('lease_id, tenant_id')
        .eq('id', invoiceId)
        .single();

      // Create payment record
      const { error: paymentError } = await supabase
        .from('payments')
        .insert({
          invoice_id: invoiceId,
          lease_id: invoice?.lease_id,
          tenant_id: invoice?.tenant_id,
          landlord_id: landlordId || null,
          amount: amount,
          payment_date: new Date().toISOString(),
          payment_method: 'mpesa_kopokopo',
          status: 'completed',
          payment_reference: transactionId,
          mpesa_receipt_number: transactionId
        });

      if (paymentError) {
        console.error('❌ Failed to create payment record:', paymentError);
      } else {
        console.log('✅ Payment record created');
      }

      // Handle service charge invoice generation if applicable
      if (paymentType === 'rent') {
        console.log('🏢 Triggering service charge invoice generation...');
        // This would be handled by the existing trigger or logic
      }

      // Send SMS receipt confirmation to tenant
      try {
        const { data: invoice } = await supabase
          .from('invoices')
          .select('tenant_id')
          .eq('id', invoiceId)
          .single();

        if (invoice?.tenant_id) {
          const { data: tenant } = await supabase
            .from('tenants')
            .select('phone, first_name, last_name')
            .eq('id', invoice.tenant_id)
            .single();

          if (tenant?.phone) {
            const smsResponse = await supabase.functions.invoke('send-sms', {
              body: {
                phone_number: tenant.phone,
                message: `Payment of KES ${amount} received. Thank you! - Zira Homes. Receipt: ${transactionId}`
              }
            });

            if (smsResponse.error) {
              console.error('❌ Error sending SMS receipt confirmation:', smsResponse.error);
            } else {
              console.log('✅ SMS receipt confirmation sent to:', tenant.phone);
            }
          } else {
            console.log('⚠️ No phone number found for tenant, skipping SMS');
          }
        }
      } catch (smsError) {
        console.error('❌ Error in SMS receipt confirmation process:', smsError);
        // Don't fail the payment process if SMS fails
      }
    } else if (finalStatus === 'failed') {
      console.log('❌ Payment failed - no further action taken');
    }

    console.log('=== KOPO KOPO CALLBACK PROCESSED SUCCESSFULLY ===');

    return new Response(
      JSON.stringify({ status: 'ok', message: 'Callback processed' }), 
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('❌ Kopo Kopo callback error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    return new Response(
      JSON.stringify({ 
        error: 'Callback processing failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), 
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
