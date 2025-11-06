import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Shield, Settings, CreditCard } from "lucide-react";

const mpesaConfigSchema = z.object({
  consumer_key: z.string().min(10, "Consumer key must be at least 10 characters"),
  consumer_secret: z.string().min(10, "Consumer secret must be at least 10 characters"),
  business_shortcode: z.string().min(5, "Business shortcode must be at least 5 characters"),
  passkey: z.string().min(20, "Passkey must be at least 20 characters"),
  callback_url: z.string().url().optional().or(z.literal("")),
  environment: z.enum(["sandbox", "production"]),
  is_active: z.boolean()
});

type MpesaConfigFormData = z.infer<typeof mpesaConfigSchema>;

interface MpesaSettingsFormProps {
  landlordId?: string;
}

export function MpesaSettingsForm({ landlordId }: MpesaSettingsFormProps) {
  const [loading, setLoading] = useState(false);
  const [configExists, setConfigExists] = useState(false);

  const form = useForm<MpesaConfigFormData>({
    resolver: zodResolver(mpesaConfigSchema),
    defaultValues: {
      consumer_key: "",
      consumer_secret: "",
      business_shortcode: "",
      passkey: "",
      callback_url: "",
      environment: "sandbox",
      is_active: true
    }
  });

  useEffect(() => {
    fetchMpesaConfig();
  }, [landlordId]);

  const fetchMpesaConfig = async () => {
    try {
      const { data: user } = await supabase.auth.getUser();
      
      // SECURITY: Only fetch non-sensitive metadata, NEVER fetch encrypted credentials
      const { data, error } = await supabase
        .from("landlord_mpesa_configs")
        .select("id, business_shortcode, callback_url, environment, is_active")
        .eq("landlord_id", user.user?.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw error;
      }

      if (data) {
        setConfigExists(true);
        // SECURITY: Never populate credential fields from database
        form.reset({
          consumer_key: "", // Never fetch credentials
          consumer_secret: "", // Never fetch credentials
          business_shortcode: data.business_shortcode,
          passkey: "", // Never fetch credentials
          callback_url: data.callback_url || "",
          environment: data.environment as "sandbox" | "production",
          is_active: data.is_active
        });
      }
    } catch (error) {
      console.error("Error fetching M-Pesa config:", error);
    }
  };

  const onSubmit = async (data: MpesaConfigFormData) => {
    setLoading(true);
    try {
      // SECURITY: Use edge function to encrypt and save credentials securely
      const { data: result, error } = await supabase.functions.invoke('save-mpesa-credentials', {
        body: {
          consumer_key: data.consumer_key,
          consumer_secret: data.consumer_secret,
          shortcode: data.business_shortcode,
          passkey: data.passkey,
          callback_url: data.callback_url || null,
          environment: data.environment,
          is_active: data.is_active
        }
      });

      if (error) throw error;
      if (result?.error) throw new Error(result.error);

      // Clear sensitive data from form for security
      form.reset({
        consumer_key: "",
        consumer_secret: "",
        business_shortcode: data.business_shortcode,
        passkey: "",
        callback_url: data.callback_url,
        environment: data.environment,
        is_active: data.is_active
      });

      setConfigExists(true);
      toast.success(configExists ? "M-Pesa settings updated securely!" : "M-Pesa settings created securely!");
    } catch (error) {
      console.error("Error saving M-Pesa config:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save M-Pesa settings");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          M-Pesa STK Push Configuration
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Configure your M-Pesa STK Push settings for tenant payments
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Environment Selection */}
          <div className="space-y-2">
            <Label htmlFor="environment">Environment</Label>
            <Select 
              value={form.watch("environment")} 
              onValueChange={(value: "sandbox" | "production") => 
                form.setValue("environment", value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox (Testing)</SelectItem>
                <SelectItem value="production">Production (Live)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Use sandbox for testing, production for live payments
            </p>
          </div>

          {/* API Credentials */}
          <div className="space-y-4 p-4 border rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="h-4 w-4" />
              <h3 className="font-medium">API Credentials</h3>
            </div>
            
            {configExists && (
              <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg text-sm text-amber-800 dark:text-amber-200 mb-4">
                <Shield className="h-4 w-4 inline mr-2" />
                Credentials are encrypted and never displayed. Re-enter to update.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="consumer_key">
                  Consumer Key {configExists && <span className="text-xs text-muted-foreground">(re-enter to update)</span>}
                </Label>
                <Input
                  id="consumer_key"
                  type="password"
                  {...form.register("consumer_key")}
                  placeholder={configExists ? "••••••••••••••••" : "Your M-Pesa consumer key"}
                />
                <p className="text-xs text-muted-foreground">Encrypted using AES-256-GCM</p>
                {form.formState.errors.consumer_key && (
                  <p className="text-xs text-red-500">
                    {form.formState.errors.consumer_key.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="consumer_secret">
                  Consumer Secret {configExists && <span className="text-xs text-muted-foreground">(re-enter to update)</span>}
                </Label>
                <Input
                  id="consumer_secret"
                  type="password"
                  {...form.register("consumer_secret")}
                  placeholder={configExists ? "••••••••••••••••" : "Your M-Pesa consumer secret"}
                />
                <p className="text-xs text-muted-foreground">Never stored in plain text</p>
                {form.formState.errors.consumer_secret && (
                  <p className="text-xs text-red-500">
                    {form.formState.errors.consumer_secret.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="business_shortcode">Business Short Code</Label>
                <Input
                  id="business_shortcode"
                  {...form.register("business_shortcode")}
                  placeholder="e.g., 4155923"
                />
                {form.formState.errors.business_shortcode && (
                  <p className="text-xs text-red-500">
                    {form.formState.errors.business_shortcode.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="passkey">
                  Passkey {configExists && <span className="text-xs text-muted-foreground">(re-enter to update)</span>}
                </Label>
                <Input
                  id="passkey"
                  type="password"
                  {...form.register("passkey")}
                  placeholder={configExists ? "••••••••••••••••••••••••" : "Your M-Pesa passkey"}
                />
                <p className="text-xs text-muted-foreground">Encrypted at rest and in transit</p>
                {form.formState.errors.passkey && (
                  <p className="text-xs text-red-500">
                    {form.formState.errors.passkey.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Callback URL */}
          <div className="space-y-2">
            <Label htmlFor="callback_url">Callback URL (Optional)</Label>
            <Input
              id="callback_url"
              {...form.register("callback_url")}
              placeholder="https://your-domain.com/mpesa/callback"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use the default system callback URL
            </p>
            {form.formState.errors.callback_url && (
              <p className="text-xs text-red-500">
                {form.formState.errors.callback_url.message}
              </p>
            )}
          </div>

          {/* Active Toggle */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <h3 className="font-medium">Enable M-Pesa Payments</h3>
              <p className="text-sm text-muted-foreground">
                Allow tenants to pay using M-Pesa STK Push
              </p>
            </div>
            <Switch
              checked={form.watch("is_active")}
              onCheckedChange={(checked) => form.setValue("is_active", checked)}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : configExists ? "Update Settings" : "Save Settings"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}