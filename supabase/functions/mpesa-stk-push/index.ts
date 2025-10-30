import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header for user authentication
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Initialize Supabase client with user auth
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { 
        global: { 
          headers: { 
            authorization: authHeader 
          } 
        } 
      }
    )

    // Verify user authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Initialize admin client only for cross-table operations after auth passes
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

  const requestBody = await req.json();
  
  // Input validation with enhanced security
  const { phone, amount, accountReference, transactionDesc, invoiceId, paymentType, landlordId, dryRun } = requestBody;

  // Rate limiting check (basic implementation)
  const rateLimitKey = `mpesa_stk_${user.id}`;
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 5;

  // Simple rate limiting using headers (in production, use Redis or similar)
  const rateLimitData = req.headers.get('x-rate-limit-data');
  let requestCount = 1;
  let windowStart = now;
  
  if (rateLimitData) {
    try {
      const parsed = JSON.parse(rateLimitData);
      if (now - parsed.windowStart < windowMs) {
        requestCount = parsed.count + 1;
        windowStart = parsed.windowStart;
      }
    } catch (e) {
      // Invalid data, use defaults
    }
  }

  if (requestCount > maxRequests) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Please wait before trying again.' }),
      { 
        status: 429, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

  // Log request with security details
  console.log('=== MPESA STK PUSH REQUEST START ===');
  const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                   req.headers.get('x-real-ip')?.trim() || 
                   'unknown';
  
  console.log('Request from IP:', clientIP);
  console.log('Request payload (sanitized):', {
    phone: phone ? `***${phone.toString().slice(-4)}` : 'missing',
    amount,
    accountReference,
    transactionDesc,
    invoiceId,
    paymentType,
    landlordId,
    dryRun,
    timestamp: new Date().toISOString()
  });

  // Enhanced input validation
  if (!phone || !amount) {
    console.error('Missing required fields:', { phone: !!phone, amount: !!amount });
    return new Response(
      JSON.stringify({ error: 'Missing required fields: phone, amount' }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

  // Validate amount is positive number
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numAmount) || numAmount <= 0 || numAmount > 1000000) {
    console.error('Invalid amount:', amount);
    return new Response(
      JSON.stringify({ error: 'Invalid amount. Must be a positive number less than 1,000,000' }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

  // Validate phone number format
  const phoneStr = phone.toString().replace(/\D/g, '');
  if (phoneStr.length < 9 || phoneStr.length > 15) {
    console.error('Invalid phone number:', phone);
    return new Response(
      JSON.stringify({ error: 'Invalid phone number format' }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

    // Move dry run check after we get M-Pesa config
    let shouldProcessDryRun = dryRun;

    // Authorization checks based on payment type
    let authorized = false;
    let landlordConfigId = landlordId;

    if (paymentType === 'service-charge') {
      // Service charge: Only landlords can pay their own service charges or admins
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      const isAdmin = userRoles?.some(r => r.role === 'Admin');

      if (isAdmin) {
        authorized = true;
      } else if (invoiceId) {
        // Check if user is the landlord for this service charge invoice
        const { data: serviceInvoice } = await supabase
          .from('service_charge_invoices')
          .select('landlord_id')
          .eq('id', invoiceId)
          .eq('landlord_id', user.id)
          .single();

        if (serviceInvoice) {
          authorized = true;
          landlordConfigId = serviceInvoice.landlord_id;
        }
      }
    } else if (paymentType === 'subscription') {
      // Subscription payment: Any authenticated user can pay for their own subscription
      authorized = true;
      landlordConfigId = user.id;
    } else {
      // Rent payment: Check if user is tenant for this invoice OR property owner/manager OR admin
      if (invoiceId) {
        const { data: invoiceAuth } = await supabase
          .from('invoices')
          .select(`
            tenant_id,
            leases!inner(
              tenant_id,
              unit_id,
              units!inner(
                property_id,
                properties!inner(owner_id, manager_id)
              )
            ),
            tenants!inner(user_id)
          `)
          .eq('id', invoiceId)
          .single();

        if (invoiceAuth) {
          const isTenant = invoiceAuth.tenants.user_id === user.id;
          const isOwner = invoiceAuth.leases.units.properties.owner_id === user.id;
          const isManager = invoiceAuth.leases.units.properties.manager_id === user.id;

          const { data: userRoles } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', user.id);
          const isAdmin = userRoles?.some(r => r.role === 'Admin');

          if (isTenant || isOwner || isManager || isAdmin) {
            authorized = true;
            landlordConfigId = invoiceAuth.leases.units.properties.owner_id;
          }
        }
      }
    }

    if (!authorized) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized to initiate this payment' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Try to get landlord-specific M-Pesa config first    
    // If no landlordId provided, try to get it from invoice
    if (!landlordConfigId && invoiceId) {
      const { data: invoiceData } = await supabaseAdmin
        .from('invoices')
        .select(`
          lease_id,
          leases!inner(
            unit_id,
            units!inner(
              property_id,
              properties!inner(owner_id)
            )
          )
        `)
        .eq('id', invoiceId)
        .single();

      if (invoiceData?.leases?.units?.properties?.owner_id) {
        landlordConfigId = invoiceData.leases.units.properties.owner_id;
      }
    }

    let mpesaConfig = null;
    if (landlordConfigId) {
      const { data: config } = await supabaseAdmin
        .from('landlord_mpesa_configs')
        .select('*')
        .eq('landlord_id', landlordConfigId)
        .eq('is_active', true)
        .maybeSingle();

      mpesaConfig = config;
      console.log('Landlord M-Pesa config found:', !!mpesaConfig);
    }

    // Helper function to decrypt credentials
    async function decryptCredential(encrypted: string, key: string): Promise<string> {
      try {
        const encoder = new TextEncoder();
        const keyData = encoder.encode(key.padEnd(32, '0').slice(0, 32));
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          keyData,
          { name: 'AES-GCM' },
          false,
          ['decrypt']
        );

        // Decode from base64
        const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);

        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          cryptoKey,
          ciphertext
        );

        return new TextDecoder().decode(decrypted);
      } catch (e) {
        console.error('Decryption error:', e);
        throw new Error('Failed to decrypt credential');
      }
    }

    // M-Pesa credentials - SECURITY: Use environment variables, decrypt landlord config
    let consumerKey, consumerSecret, shortcode, passkey;
    const environment = mpesaConfig?.environment || Deno.env.get('MPESA_ENVIRONMENT') || 'sandbox';

    if (mpesaConfig && mpesaConfig.consumer_key_encrypted) {
      // Decrypt landlord-specific encrypted credentials
      const encryptionKey = Deno.env.get('DATA_ENCRYPTION_KEY');
      if (!encryptionKey) {
        console.error('Encryption key not configured');
        // Fallback to environment variables
        consumerKey = Deno.env.get('MPESA_CONSUMER_KEY');
        consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET');
        shortcode = Deno.env.get('MPESA_SHORTCODE') || '174379';
        passkey = Deno.env.get('MPESA_PASSKEY');
      } else {
        try {
          // Decrypt all credentials in parallel
          const [decryptedKey, decryptedSecret, decryptedShortcode, decryptedPasskey] = await Promise.all([
            decryptCredential(mpesaConfig.consumer_key_encrypted, encryptionKey),
            decryptCredential(mpesaConfig.consumer_secret_encrypted, encryptionKey),
            decryptCredential(mpesaConfig.shortcode_encrypted, encryptionKey),
            decryptCredential(mpesaConfig.passkey_encrypted, encryptionKey)
          ]);

          consumerKey = decryptedKey;
          consumerSecret = decryptedSecret;
          shortcode = decryptedShortcode;
          passkey = decryptedPasskey;
          console.log('Successfully decrypted landlord M-Pesa credentials');
        } catch (decryptError) {
          console.error('Failed to decrypt landlord M-Pesa config:', decryptError);
          // Fallback to environment variables
          consumerKey = Deno.env.get('MPESA_CONSUMER_KEY');
          consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET');
          shortcode = Deno.env.get('MPESA_SHORTCODE') || '174379';
          passkey = Deno.env.get('MPESA_PASSKEY');
        }
      }
    } else {
      // Use secure environment variables
      consumerKey = Deno.env.get('MPESA_CONSUMER_KEY');
      consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET');
      shortcode = Deno.env.get('MPESA_SHORTCODE') || '174379';
      passkey = Deno.env.get('MPESA_PASSKEY');
    }

    console.log('M-Pesa Environment Check:', {
      hasConsumerKey: !!consumerKey,
      hasConsumerSecret: !!consumerSecret,
      shortcode,
      hasPasskey: !!passkey,
      environment,
      usingLandlordConfig: !!mpesaConfig
    })

    // Handle dry run after we have all configuration
    if (shouldProcessDryRun) {
      console.log('DRY RUN: Mock STK push response');
      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          message: 'Mock STK push - no actual payment initiated',
          data: {
            CheckoutRequestID: 'mock-checkout-' + Date.now(),
            MerchantRequestID: 'mock-merchant-' + Date.now(),
            ResponseDescription: 'Mock STK push sent successfully',
            BusinessShortCode: shortcode,
            UsingLandlordConfig: !!mpesaConfig
          }
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    if (!consumerKey || !consumerSecret || !passkey) {
      console.error('Missing M-Pesa credentials:', {
        missingConsumerKey: !consumerKey,
        missingConsumerSecret: !consumerSecret,
        missingPasskey: !passkey
      })
      return new Response(
        JSON.stringify({ 
          error: 'M-Pesa configuration incomplete. Please configure M-Pesa credentials.',
          missing: {
            consumerKey: !consumerKey,
            consumerSecret: !consumerSecret,
            passkey: !passkey
          }
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Get OAuth token
    const authUrl = environment === 'production' 
      ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
      : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'

    const authResponse = await fetch(authUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${btoa(`${consumerKey}:${consumerSecret}`)}`
      }
    })

    const authData = await authResponse.json()
    
    if (!authData.access_token) {
      console.error('Failed to get M-Pesa token:', authData)
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with M-Pesa' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Generate timestamp and password
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3)
    const password = btoa(`${shortcode}${passkey}${timestamp}`)

    // Format phone number
    let phoneNumber = phone.toString().replace(/\D/g, '')
    if (phoneNumber.startsWith('0')) {
      phoneNumber = '254' + phoneNumber.slice(1)
    } else if (!phoneNumber.startsWith('254')) {
      phoneNumber = '254' + phoneNumber
    }

    // STK Push request
    const stkUrl = environment === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest'

    // Use custom callback URL if provided in config
    const callbackUrl = mpesaConfig?.callback_url || `${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-callback`;

    // Determine transaction type based on shortcode type
    const transactionType = mpesaConfig?.shortcode_type === 'till' 
      ? 'CustomerBuyGoodsOnline' 
      : 'CustomerPayBillOnline';

    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: Math.round(amount),
      PartyA: phoneNumber,
      PartyB: shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: callbackUrl,
      AccountReference: accountReference || (paymentType === 'service-charge' ? 'ZIRA-SERVICE' : `INV-${invoiceId}`),
      TransactionDesc: transactionDesc || (paymentType === 'service-charge' ? 'Zira Homes Service Charge' : 'Payment for ' + (accountReference || `INV-${invoiceId}`))
    }

    console.log('STK Push payload:', JSON.stringify(stkPayload, null, 2))

    const stkResponse = await fetch(stkUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(stkPayload)
    })

    const stkData = await stkResponse.json()
    console.log('STK Push response:', JSON.stringify(stkData, null, 2))

    if (stkData.ResponseCode === '0') {
      // Store the transaction in database with security tracking
      const transactionData = {
        checkout_request_id: stkData.CheckoutRequestID,
        merchant_request_id: stkData.MerchantRequestID,
        phone_number: phoneNumber,
        amount: Math.round(amount),
        status: 'pending',
        created_at: new Date().toISOString(),
        payment_type: paymentType || 'rent',
        initiated_by: user.id,
        authorized_by: user.id
      }

      // Only add invoice_id if it's a valid UUID (for rent payments)
      if (invoiceId && paymentType !== 'service-charge') {
        transactionData.invoice_id = invoiceId
      }

      // For service charge payments, store additional metadata
      if (paymentType === 'service-charge') {
        console.log('Processing service charge payment, validating invoice:', invoiceId);

        // Validate that the service charge invoice exists before processing
        if (invoiceId) {
          // Use admin client to bypass RLS for invoice validation
          const { data: serviceInvoice, error: invoiceCheckError } = await supabaseAdmin
            .from('service_charge_invoices')
            .select('id, status, invoice_number, total_amount, landlord_id')
            .eq('id', invoiceId)
            .maybeSingle()

          if (invoiceCheckError || !serviceInvoice) {
            console.error('Service charge invoice validation failed:', {
              invoiceId,
              error: invoiceCheckError,
              errorDetails: invoiceCheckError?.details,
              errorMessage: invoiceCheckError?.message
            });
            return new Response(
              JSON.stringify({
                success: false,
                error: 'Service charge invoice not found',
                invoiceId: invoiceId,
                details: invoiceCheckError?.message
              }),
              {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              }
            )
          }

          console.log('Service charge invoice validated successfully:', {
            id: serviceInvoice.id,
            invoice_number: serviceInvoice.invoice_number,
            status: serviceInvoice.status,
            total_amount: serviceInvoice.total_amount,
            landlord_id: serviceInvoice.landlord_id
          });

          if (serviceInvoice.status === 'paid') {
            console.warn('Service charge invoice already paid:', serviceInvoice.id);
            return new Response(
              JSON.stringify({
                success: false,
                error: 'Service charge invoice already paid',
                invoiceId: invoiceId
              }),
              {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              }
            )
          }
        }

        transactionData.metadata = {
          service_charge_invoice_id: invoiceId,
          payment_type: 'service-charge',
          landlord_id: landlordConfigId
        }
        console.log('Service charge metadata added to transaction:', transactionData.metadata);
      } else if (paymentType === 'subscription') {
        // For subscription payments, store subscription metadata
        console.log('Processing subscription payment for user:', user.id);
        transactionData.metadata = {
          payment_type: 'subscription',
          landlord_id: user.id,
          account_reference: accountReference
        }
        console.log('Subscription metadata added to transaction:', transactionData.metadata);
      }

      console.log('Creating M-Pesa transaction record:', {
        checkout_request_id: transactionData.checkout_request_id,
        merchant_request_id: transactionData.merchant_request_id,
        phone_number: transactionData.phone_number,
        amount: transactionData.amount,
        payment_type: transactionData.payment_type,
        metadata: transactionData.metadata
      });

      const { error: dbError } = await supabase
        .from('mpesa_transactions')
        .insert(transactionData)

      if (dbError) {
        console.error('Database transaction insertion error:', {
          error: dbError,
          errorMessage: dbError?.message,
          errorDetails: dbError?.details,
          transactionData
        });
      } else {
        console.log('M-Pesa transaction record created successfully:', transactionData.checkout_request_id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'STK push sent successfully',
          data: {
            CheckoutRequestID: stkData.CheckoutRequestID,
            MerchantRequestID: stkData.MerchantRequestID,
            ResponseDescription: stkData.ResponseDescription,
            BusinessShortCode: shortcode,
            UsingLandlordConfig: !!mpesaConfig
          }
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    } else {
      console.error('STK Push failed:', stkData)
      return new Response(
        JSON.stringify({
          success: false,
          error: stkData.ResponseDescription || 'STK push failed',
          data: stkData
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

  } catch (error) {
    console.error('Error in STK push:', error)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: errorMessage,
        stack: errorStack,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
