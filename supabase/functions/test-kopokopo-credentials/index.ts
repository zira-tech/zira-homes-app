import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestKopokopoRequest {
  client_id: string;
  client_secret: string;
  environment: 'sandbox' | 'production';
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id, client_secret, environment }: TestKopokopoRequest = await req.json();

    console.log('Testing Kopo Kopo credentials:', { client_id, environment });

    // Validate required fields
    if (!client_id || !client_secret || !environment) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: client_id, client_secret, or environment' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Determine the correct auth URL based on environment
    const authUrl = environment === 'production'
      ? 'https://api.kopokopo.com/oauth/token'
      : 'https://sandbox.kopokopo.com/oauth/token';

    // Test the OAuth connection
    const authResponse = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id,
        client_secret,
        grant_type: 'client_credentials',
      }),
    });

    const authData = await authResponse.json();

    if (!authResponse.ok) {
      console.error('Kopo Kopo OAuth failed:', authData);
      
      // Parse error message
      let errorMessage = 'Invalid credentials. Please check your Client ID and Client Secret.';
      
      if (authData.error === 'invalid_client') {
        errorMessage = 'Invalid Client ID or Client Secret. Please verify your OAuth credentials.';
      } else if (authData.error === 'unauthorized') {
        errorMessage = 'Unauthorized. Your credentials may not have the necessary permissions.';
      } else if (authData.error_description) {
        errorMessage = authData.error_description;
      }

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: errorMessage,
          details: authData.error || 'Authentication failed'
        }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Successfully authenticated
    console.log('Kopo Kopo credentials validated successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Credentials validated successfully',
        token_type: authData.token_type,
        expires_in: authData.expires_in
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error testing Kopo Kopo credentials:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to test credentials. Please try again.',
        details: 'Network or server error'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
