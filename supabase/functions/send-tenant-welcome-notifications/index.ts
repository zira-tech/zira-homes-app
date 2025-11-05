import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRequest {
  tenantId: string;
  includeEmail?: boolean;
  includeSMS?: boolean;
}

// Generate a random password
function generatePassword(length = 12): string {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    password += charset[array[i] % charset.length];
  }
  return password;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase configuration");
    }

    // Create admin client to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { tenantId, includeEmail = true, includeSMS = true }: NotificationRequest = await req.json();

    if (!tenantId) {
      return new Response(
        JSON.stringify({ success: false, error: "tenantId is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`📧 Processing welcome notifications for tenant: ${tenantId}`);

    // Fetch tenant details including property and unit info
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from("tenants")
      .select(`
        id,
        first_name,
        last_name,
        email,
        phone,
        user_id,
        leases!inner(
          unit_id,
          units!inner(
            unit_number,
            property_id,
            properties!inner(
              name
            )
          )
        )
      `)
      .eq("id", tenantId)
      .single();

    if (tenantError || !tenant) {
      console.error("Failed to fetch tenant:", tenantError);
      return new Response(
        JSON.stringify({ success: false, error: "Tenant not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const tenantName = `${tenant.first_name} ${tenant.last_name}`;
    const propertyName = (tenant.leases?.[0]?.units?.properties as any)?.name || "Your Property";
    const unitNumber = tenant.leases?.[0]?.units?.unit_number || "N/A";

    // Generate temporary password
    const temporaryPassword = generatePassword(12);
    console.log(`🔑 Generated temporary password for ${tenant.email}`);

    // Create or update auth user with temporary password
    if (tenant.user_id) {
      // User already exists, update password
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        tenant.user_id,
        { password: temporaryPassword }
      );
      
      if (updateError) {
        console.error("Failed to update user password:", updateError);
      } else {
        console.log(`✅ Updated password for existing user ${tenant.user_id}`);
      }
    } else {
      // Create new auth user
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: tenant.email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          first_name: tenant.first_name,
          last_name: tenant.last_name,
        },
      });

      if (createError) {
        console.error("Failed to create auth user:", createError);
      } else if (newUser.user) {
        console.log(`✅ Created new auth user ${newUser.user.id}`);
        
        // Link tenant to auth user
        await supabaseAdmin
          .from("tenants")
          .update({ user_id: newUser.user.id })
          .eq("id", tenantId);

        // Assign Tenant role
        await supabaseAdmin
          .from("user_roles")
          .insert({ user_id: newUser.user.id, role: "Tenant" });
      }
    }

    const loginUrl = `${supabaseUrl.replace('.supabase.co', '')}/auth`;
    const results: any = { tenantId, email: null, sms: null };

    // Send Email
    if (includeEmail) {
      try {
        const { data: emailData, error: emailError } = await supabaseAdmin.functions.invoke(
          "send-welcome-email",
          {
            body: {
              tenantEmail: tenant.email,
              tenantName,
              propertyName,
              unitNumber,
              temporaryPassword,
              loginUrl,
            },
          }
        );

        if (emailError) {
          console.error("❌ Email sending failed:", emailError);
          results.email = { success: false, error: emailError.message };
        } else {
          console.log("✅ Welcome email sent successfully");
          results.email = { success: true, data: emailData };
        }
      } catch (error: any) {
        console.error("❌ Email exception:", error);
        results.email = { success: false, error: error.message };
      }
    }

    // Send SMS
    if (includeSMS && tenant.phone) {
      try {
        const smsMessage = `Welcome to Zira Homes! Your login:\nEmail: ${tenant.email}\nPassword: ${temporaryPassword}\nLogin: ${loginUrl}`;
        
        const { data: smsData, error: smsError } = await supabaseAdmin.functions.invoke(
          "send-sms-with-logging",
          {
            body: {
              phone_number: tenant.phone,
              message: smsMessage,
              message_type: "tenant_welcome",
            },
          }
        );

        if (smsError) {
          console.error("❌ SMS sending failed:", smsError);
          results.sms = { success: false, error: smsError.message };
        } else {
          console.log("✅ Welcome SMS sent successfully");
          results.sms = { success: true, data: smsData };
        }
      } catch (error: any) {
        console.error("❌ SMS exception:", error);
        results.sms = { success: false, error: error.message };
      }
    } else if (includeSMS && !tenant.phone) {
      results.sms = { success: false, error: "No phone number provided" };
    }

    // Overall success if at least one notification succeeded
    const overallSuccess = results.email?.success || results.sms?.success;

    return new Response(
      JSON.stringify({
        success: overallSuccess,
        results,
        tenant: {
          id: tenant.id,
          email: tenant.email,
          name: tenantName,
        },
      }),
      {
        status: overallSuccess ? 200 : 207, // 207 = Multi-Status
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("❌ Error in send-tenant-welcome-notifications:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
