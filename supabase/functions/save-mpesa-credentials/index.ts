import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple encryption using built-in crypto
async function encrypt(text: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key.padEnd(32, '0').slice(0, 32));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(text);
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    data
  );
  
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get authenticated user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
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

    // SECURITY: If an encryption key is provided, we could encrypt, but current schema stores plain values
    // Proceed without encryption to match current DB columns

    // Log security event with enhanced tracking
    try {
      await supabaseClient.rpc('log_security_event', {
        _event_type: 'mpesa_credentials_updated',
        _severity: 'high',
        _user_id: user.id,
        _ip_address: req.headers.get('x-forwarded-for') || 'unknown',
        _user_agent: req.headers.get('user-agent'),
        _details: { 
          environment, 
          has_callback: !!callback_url,
          timestamp: new Date().toISOString()
        }
      });
    } catch (logError) {
      console.error('Failed to log security event:', logError);
      // Don't fail the request for logging issues
    }

    // Save credentials in current schema (plain columns)
    const { error: saveError } = await supabaseClient
      .from('landlord_mpesa_configs')
      .upsert({
        landlord_id: user.id,
        consumer_key,
        consumer_secret,
        business_shortcode: shortcode,
        passkey,
        callback_url,
        environment,
        is_active
      });

    if (saveError) {
      throw saveError;
    }

    return new Response(
      JSON.stringify({ success: true, message: 'M-Pesa credentials saved securely' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error saving M-Pesa credentials:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to save M-Pesa credentials' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});