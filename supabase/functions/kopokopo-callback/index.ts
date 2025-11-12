import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 🔖 VERSION: 2025-11-12-v2.3 - Improved reconciliation + result_code: 0 for UI compat
  console.log('🚀 kopokopo-callback VERSION: 2025-11-12-v2.3 (reference-based reconciliation + result_code for UI)');
  
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

    // Determine final status - support multiple success variations
    const statusLower = (status || '').toLowerCase();
    const successStatuses = ['success', 'successful', 'processed', 'completed', 'paid'];
    const isSuccess = successStatuses.includes(statusLower);
    
    const finalStatus = isSuccess ? 'completed' : 'failed';
    const resultCode = isSuccess ? 0 : 1; // 0 for success (UI compatibility)
    const resultDesc = isSuccess ? 'Payment successful' : (attributes.failure_reason || 'Payment failed');

    // Check if we should update existing transaction or insert new one
    // Priority 1: Look for pending transaction by metadata.reference (most reliable)
    let existingTxn = null;
    
    if (reference) {
      console.log('🔍 Looking for pending transaction with metadata.reference:', reference);
      const { data: allPending } = await supabase
        .from('mpesa_transactions')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10);
      
      // Filter client-side for jsonb contains (more reliable)
      if (allPending && allPending.length > 0) {
        existingTxn = allPending.find(tx => 
          tx.metadata && tx.metadata.reference === reference
        );
        
        if (existingTxn) {
          console.log('✅ Found pending transaction by reference match:', existingTxn.checkout_request_id);
        } else {
          console.log('No pending transaction matched reference:', reference);
        }
      }
    }
    
    // Priority 2: Fallback to invoice_id if present
    if (!existingTxn && invoiceId) {
      console.log('🔍 Fallback: Looking for pending transaction by invoice_id:', invoiceId);
      const { data } = await supabase
        .from('mpesa_transactions')
        .select('*')
        .eq('invoice_id', invoiceId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data) {
        existingTxn = data;
        console.log('Found pending transaction by invoice_id:', existingTxn.checkout_request_id);
      }
    }
    
    // Priority 3: Fallback to phone + amount within last 5 minutes
    if (!existingTxn && phoneNumber && amount) {
      console.log('🔍 Fallback: Looking for pending transaction by phone and amount (recent)');
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      
      const { data } = await supabase
        .from('mpesa_transactions')
        .select('*')
        .eq('phone_number', phoneNumber)
        .eq('amount', amount)
        .eq('status', 'pending')
        .gte('created_at', fiveMinutesAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data) {
        existingTxn = data;
        console.log('Found pending transaction by phone/amount:', existingTxn.checkout_request_id);
      }
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
      console.log('✅ Updating existing pending transaction:', existingTxn.checkout_request_id);
      
      // Use the invoice_id from the existing transaction if not in callback
      const effectiveInvoiceId = invoiceId || existingTxn.invoice_id;
      if (effectiveInvoiceId) {
        console.log('📋 Using invoice ID for reconciliation:', effectiveInvoiceId);
        console.log('   - From callback metadata:', invoiceId || '(empty)');
        console.log('   - From existing transaction:', existingTxn.invoice_id || '(empty)');
      }
  const { error: updateError } = await supabase
    .from('mpesa_transactions')
    .update({
      result_code: resultCode,
      result_desc: resultDesc,
      mpesa_receipt_number: transactionId,
      phone_number: phoneNumber || existingTxn.phone_number,
      amount: amount || existingTxn.amount,
      status: finalStatus,
      provider: 'kopokopo',
      metadata: {
        ...existingTxn.metadata,
        provider: 'kopokopo',
        callback_reference: reference,
        transaction_id: transactionId,
        sender_first_name: senderFirstName,
        sender_last_name: senderLastName,
        raw_callback: callbackData,
        reconciled: true
      }
    })
    .eq('id', existingTxn.id);

      if (updateError) {
        console.error('❌ Failed to update transaction:', updateError);
      } else {
        console.log('✅ Transaction updated to', finalStatus, 'with result_code:', resultCode);
      }
    } else {
      // Insert new transaction record with unique checkout_request_id to avoid conflicts
      console.log('⚠️  No existing pending transaction found, creating new record (last resort)');
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
          provider: 'kopokopo',
          metadata: {
            provider: 'kopokopo',
            reference: reference,
            transaction_id: transactionId,
            landlord_id: landlordId,
            sender_first_name: senderFirstName,
            sender_last_name: senderLastName,
            raw_callback: callbackData,
            reconciled: false,
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
    // Use invoice ID from existing transaction if available
    const finalInvoiceId = existingTxn?.invoice_id || invoiceId;
    
    console.log('🔍 Reconciliation check:', {
      finalStatus,
      callbackInvoiceId: invoiceId || '(empty)',
      existingTxnInvoiceId: existingTxn?.invoice_id || '(empty)',
      finalInvoiceId: finalInvoiceId || '(empty)'
    });
    
    if (finalStatus === 'completed' && finalInvoiceId) {
      console.log(`📝 Processing successful payment for invoice ${finalInvoiceId}`);

      // Update invoice status
      const { error: invoiceError } = await supabase
        .from('invoices')
        .update({ 
          status: 'paid',
          payment_date: new Date().toISOString()
        })
        .eq('id', finalInvoiceId);

      if (invoiceError) {
        console.error('❌ Failed to update invoice:', invoiceError);
      } else {
        console.log('✅ Invoice status updated to paid');
      }

      // Get invoice details for payment record
      const { data: invoice } = await supabase
        .from('invoices')
        .select('lease_id, tenant_id')
        .eq('id', finalInvoiceId)
        .single();

      // Create payment record
      const { error: paymentError } = await supabase
        .from('payments')
        .insert({
          invoice_id: finalInvoiceId,
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
          .eq('id', finalInvoiceId)
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
