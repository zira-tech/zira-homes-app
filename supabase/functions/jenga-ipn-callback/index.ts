import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const ipnData = await req.json()
    console.log('=== JENGA IPN CALLBACK RECEIVED ===');
    console.log('Raw IPN Data:', JSON.stringify(ipnData, null, 2));
    
    // Get client IP for security logging
    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     req.headers.get('x-real-ip')?.trim() || 
                     req.headers.get('cf-connecting-ip')?.trim() ||
                     'unknown';
    
    console.log('Jenga IPN from IP:', clientIP);

    // Validate IPN structure
    if (!ipnData.callbackType || !ipnData.transaction) {
      console.error('Invalid IPN format - missing required fields');
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Invalid IPN format' 
      }), { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Extract IPN data
    const { callbackType, customer, transaction, bank } = ipnData;
    
    // Parse transaction reference to find landlord and invoice
    // Format expected: LANDLORD_ID-INVOICE_ID or similar
    let landlordId: string | null = null;
    let invoiceId: string | null = null;
    
    // Try to extract from bill number or customer reference
    const billNumber = transaction.billNumber;
    const customerRef = customer?.reference;
    
    console.log('Parsing references:', { billNumber, customerRef });

    // Store the IPN callback
    const { data: callback, error: insertError } = await supabase
      .from('jenga_ipn_callbacks')
      .insert({
        callback_type: callbackType,
        customer_name: customer?.name,
        customer_mobile: customer?.mobileNumber,
        customer_reference: customerRef,
        transaction_date: transaction.date,
        transaction_reference: transaction.reference,
        payment_mode: transaction.paymentMode,
        amount: transaction.amount,
        bill_number: billNumber,
        served_by: transaction.servedBy,
        additional_info: transaction.additionalInfo,
        order_amount: transaction.orderAmount,
        service_charge: transaction.serviceCharge,
        status: transaction.status,
        remarks: transaction.remarks,
        bank_reference: bank?.reference,
        transaction_type: bank?.transactionType,
        bank_account: bank?.account,
        landlord_id: landlordId,
        invoice_id: invoiceId,
        raw_data: ipnData,
        ip_address: clientIP,
        processed: false
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error storing IPN callback:', insertError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Failed to store callback' 
      }), { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('IPN callback stored successfully:', callback.id);

    // Process successful payments
    if (transaction.status === 'SUCCESS' && invoiceId) {
      console.log('Processing successful payment for invoice:', invoiceId);
      
      try {
        // Update invoice status
        const { error: updateError } = await supabase
          .from('invoices')
          .update({
            status: 'paid',
            updated_at: new Date().toISOString()
          })
          .eq('id', invoiceId)
          .eq('status', 'pending'); // Only update if still pending

        if (updateError) {
          console.error('Error updating invoice:', updateError);
        } else {
          console.log('Invoice marked as paid:', invoiceId);
          
          // Create payment record
          const { data: invoice } = await supabase
            .from('invoices')
            .select('*, leases!inner(*)')
            .eq('id', invoiceId)
            .single();

          if (invoice) {
            await supabase
              .from('payments')
              .insert({
                tenant_id: invoice.tenant_id,
                lease_id: invoice.lease_id,
                invoice_id: invoiceId,
                amount: transaction.amount,
                payment_date: new Date().toISOString().split('T')[0],
                payment_method: 'Jenga PAY',
                payment_reference: transaction.reference,
                transaction_id: bank?.reference,
                status: 'completed',
                payment_type: 'rent',
                notes: `Jenga PAY payment via ${transaction.paymentMode}. Receipt: ${transaction.reference}`
              });
            
            console.log('Payment record created for invoice:', invoiceId);
          }

          // Mark callback as processed
          await supabase
            .from('jenga_ipn_callbacks')
            .update({
              processed: true,
              processed_at: new Date().toISOString(),
              landlord_id: landlordId,
              invoice_id: invoiceId
            })
            .eq('id', callback.id);
        }

        // Send notification to landlord
        if (landlordId) {
          await supabase
            .from('notifications')
            .insert({
              user_id: landlordId,
              title: 'Payment Received',
              message: `Payment of KES ${transaction.amount} received via Jenga PAY. Receipt: ${transaction.reference}`,
              type: 'payment',
              related_id: invoiceId,
              related_type: 'invoice'
            });
        }
      } catch (processingError) {
        console.error('Error processing payment:', processingError);
        // Don't return error - callback is stored, can be reprocessed
      }
    } else if (transaction.status !== 'SUCCESS') {
      console.log('Transaction not successful:', transaction.status, transaction.remarks);
      
      // Mark callback as processed (failed)
      await supabase
        .from('jenga_ipn_callbacks')
        .update({
          processed: true,
          processed_at: new Date().toISOString()
        })
        .eq('id', callback.id);
    }

    // Log security event
    await supabase.rpc('log_security_event', {
      _event_type: 'data_access',
      _details: {
        source: 'jenga_ipn_callback',
        action: 'payment_notification_received',
        transaction_reference: transaction.reference,
        status: transaction.status,
        amount: transaction.amount,
        ip: clientIP,
        timestamp: new Date().toISOString()
      },
      _ip_address: clientIP
    });

    // Return success response
    return new Response(JSON.stringify({ 
      success: true,
      message: 'IPN processed successfully',
      callback_id: callback.id 
    }), { 
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Jenga IPN callback error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
