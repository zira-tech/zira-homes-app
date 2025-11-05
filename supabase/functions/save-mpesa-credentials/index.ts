import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Secure encryption using AES-256-GCM with Deno's crypto API
async function encryptCredential(plaintext: string): Promise<string> {
  const encoder = new TextEncoder();
  
  // Get encryption key from environment (Supabase secret)
  const encryptionKeyBase64 = Deno.env.get('MPESA_ENCRYPTION_KEY');
  if (!encryptionKeyBase64) {
    throw new Error('MPESA_ENCRYPTION_KEY environment variable not set');
  }
  
  // Decode the base64 key
  const keyData = Uint8Array.from(atob(encryptionKeyBase64), c => c.charCodeAt(0));
  
  // Import key for AES-GCM
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  // Generate random IV (initialization vector)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // Encrypt the data
  const encryptedData = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoder.encode(plaintext)
  );
  
  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encryptedData.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encryptedData), iv.length);
  
  // Return as base64
  return btoa(String.fromCharCode(...combined));
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client with user context
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Create admin client for secure operations (uses service role)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Get authenticated user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      console.error('Authentication error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const {
      consumer_key,
      consumer_secret,
      shortcode,
      passkey,
      callback_url,
      environment,
      is_active
    } = await req.json();

    // Validate required fields
    if (!consumer_key || !consumer_secret || !shortcode || !passkey) {
      return new Response(
        JSON.stringify({ error: 'Missing required M-Pesa credentials' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate field lengths for security
    if (consumer_key.length < 10 || consumer_secret.length < 10 || 
        shortcode.length < 5 || passkey.length < 20) {
      return new Response(
        JSON.stringify({ error: 'Invalid credential format - credentials too short' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[MPESA-CREDS] Saving encrypted credentials for landlord: ${user.id}`);

    // SECURITY: Encrypt all sensitive credentials before storage
    let encryptedConsumerKey: string;
    let encryptedConsumerSecret: string;
    let encryptedPasskey: string;

    try {
      encryptedConsumerKey = await encryptCredential(consumer_key);
      encryptedConsumerSecret = await encryptCredential(consumer_secret);
      encryptedPasskey = await encryptCredential(passkey);
      
      console.log('[MPESA-CREDS] Credentials encrypted successfully');
    } catch (encryptError) {
      console.error('[MPESA-CREDS] Encryption error:', encryptError);
      return new Response(
        JSON.stringify({ error: 'Failed to encrypt credentials - check server configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log security event BEFORE saving (for audit trail)
    try {
      await supabaseAdmin.rpc('log_security_event', {
        _event_type: 'mpesa_credentials_save_attempt',
        _severity: 'high',
        _user_id: user.id,
        _ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
        _user_agent: req.headers.get('user-agent') || 'unknown',
        _details: { 
          environment, 
          has_callback: !!callback_url,
          shortcode_prefix: shortcode.substring(0, 3) + '***',
          timestamp: new Date().toISOString(),
          action: 'credential_save'
        }
      });
    } catch (logError) {
      console.error('[MPESA-CREDS] Failed to log security event:', logError);
      // Don't fail the request for logging issues
    }

    // Save ONLY encrypted credentials using admin client (bypasses RLS for secure insert)
    const { data: savedConfig, error: saveError } = await supabaseAdmin
      .from('landlord_mpesa_configs')
      .upsert({
        landlord_id: user.id,
        consumer_key_encrypted: encryptedConsumerKey,
        consumer_secret_encrypted: encryptedConsumerSecret,
        passkey_encrypted: encryptedPasskey,
        business_shortcode: shortcode,
        callback_url: callback_url || null,
        environment: environment || 'sandbox',
        is_active: is_active !== false, // Default to true
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'landlord_id',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (saveError) {
      console.error('[MPESA-CREDS] Database save error:', saveError);
      
      // Log failure
      await supabaseAdmin.rpc('log_security_event', {
        _event_type: 'mpesa_credentials_save_failed',
        _severity: 'high',
        _user_id: user.id,
        _ip_address: req.headers.get('x-forwarded-for') || 'unknown',
        _user_agent: req.headers.get('user-agent'),
        _details: { 
          error: saveError.message,
          code: saveError.code,
          timestamp: new Date().toISOString()
        }
      }).catch(err => console.error('Failed to log error event:', err));
      
      throw saveError;
    }

    console.log(`[MPESA-CREDS] Credentials saved successfully for landlord: ${user.id}`);

    // Log successful save
    await supabaseAdmin.rpc('log_security_event', {
      _event_type: 'mpesa_credentials_saved',
      _severity: 'high',
      _user_id: user.id,
      _ip_address: req.headers.get('x-forwarded-for') || 'unknown',
      _user_agent: req.headers.get('user-agent'),
      _details: { 
        environment,
        config_id: savedConfig?.id,
        timestamp: new Date().toISOString(),
        action: 'credential_save_success'
      }
    }).catch(err => console.error('Failed to log success event:', err));

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'M-Pesa credentials encrypted and saved securely',
        config_id: savedConfig?.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[MPESA-CREDS] Critical error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to save M-Pesa credentials',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});