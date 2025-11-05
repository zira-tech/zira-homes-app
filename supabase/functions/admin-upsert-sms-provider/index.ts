import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // User client for authentication
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header', details: 'No auth token provided' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    
    if (authError || !user) {
      console.error('Invalid authentication token:', authError?.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authentication token', details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('User authenticated:', user.id);

    // Check Admin, Landlord or Manager role
    const [{ data: isAdmin }, { data: isLandlord }, { data: isManager }] = await Promise.all([
      userClient.rpc('has_role', { _user_id: user.id, _role: 'Admin' }),
      userClient.rpc('has_role', { _user_id: user.id, _role: 'Landlord' }),
      userClient.rpc('has_role', { _user_id: user.id, _role: 'Manager' }),
    ]);

    if (!isAdmin && !isLandlord && !isManager) {
      console.error('Insufficient permissions for user:', user.id);
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized', details: 'Admin, Landlord or Manager role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Admin client for DB operations (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { id, provider_name, sender_id, base_url, is_active, is_default, config_data } = body;

    console.log('Upsert request:', { user_id: user.id, provider_name, has_id: !!id, base_url });

    if (!provider_name) {
      return new Response(
        JSON.stringify({ success: false, error: 'Validation failed', details: 'provider_name is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize base_url
    let normalizedBaseUrl = base_url?.trim();
    if (normalizedBaseUrl && !normalizedBaseUrl.endsWith('/')) {
      normalizedBaseUrl += '/';
    }

    console.log('Normalized base_url:', normalizedBaseUrl);

    const payload: any = {
      provider_name,
      sender_id,
      base_url: normalizedBaseUrl,
      is_active: is_active ?? true,
      is_default: is_default ?? false,
      config_data,
      updated_at: new Date().toISOString()
    };

    let result;
    let operationPath = '';

    if (id) {
      // Try updating by ID first
      console.log('Attempting update by ID:', id);
      const { data, error, count } = await adminClient
        .from('sms_providers')
        .update(payload)
        .eq('id', id)
        .select();

      if (error || !data || data.length === 0) {
        console.log('Update by ID failed, falling back to upsert. Error:', error?.message, 'Count:', count);
        operationPath = 'update-failed-fallback-to-upsert';
        
        // Fallback to upsert by provider_name
        const { data: upsertData, error: upsertError } = await adminClient
          .from('sms_providers')
          .upsert({ ...payload, id }, { onConflict: 'provider_name' })
          .select()
          .single();

        if (upsertError) {
          console.error('Upsert fallback failed:', upsertError);
          throw upsertError;
        }
        result = upsertData;
        console.log('Fallback upsert succeeded:', result.id);
      } else {
        result = data[0];
        operationPath = 'update-by-id';
        console.log('Update by ID succeeded:', result.id);
      }
    } else {
      // No ID provided, do upsert
      console.log('No ID provided, performing upsert by provider_name');
      operationPath = 'upsert-new';
      const { data, error } = await adminClient
        .from('sms_providers')
        .upsert(payload, { onConflict: 'provider_name' })
        .select()
        .single();

      if (error) {
        console.error('Upsert failed:', error);
        throw error;
      }
      result = data;
      console.log('Upsert succeeded:', result.id);
    }

    console.log('SMS provider saved:', { id: result.id, path: operationPath });

    return new Response(
      JSON.stringify({ success: true, provider: result, details: `Operation: ${operationPath}` }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error upserting SMS provider:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Unknown error',
        details: error.details || error.hint || 'No additional details'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);
