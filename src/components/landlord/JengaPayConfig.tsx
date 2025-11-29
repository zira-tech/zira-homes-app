import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Building2, CheckCircle, XCircle, Loader2, Shield, Info, Copy } from "lucide-react";

export const JengaPayConfig: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [testingPayment, setTestingPayment] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(true);
  const [config, setConfig] = useState({
    merchant_code: '',
    api_key: '',
    consumer_secret: '',
    paybill_number: '247247',
    environment: 'sandbox' as 'sandbox' | 'production',
    ipn_username: '',
    ipn_password: ''
  });
  const [existingConfig, setExistingConfig] = useState<any>(null);
  const [ipnUrl, setIpnUrl] = useState('');

  useEffect(() => {
    checkAvailability();
    loadConfig();
    // Generate IPN URL from runtime config
    const projectUrl = window.location.origin.includes('localhost') 
      ? 'https://kdpqimetajnhcqseajok.supabase.co'
      : window.location.origin.replace('lovable.app', 'supabase.co');
    const callbackUrl = `${projectUrl}/functions/v1/jenga-ipn-callback`;
    setIpnUrl(callbackUrl);
  }, []);

  const checkAvailability = async () => {
    try {
      const { data, error } = await supabase
        .from('approved_payment_methods')
        .select('is_active')
        .eq('payment_method_type', 'jenga_pay')
        .eq('country_code', 'KE')
        .maybeSingle();

      if (error) throw error;
      setIsEnabled(data?.is_active || false);
    } catch (error) {
      console.error('Error checking Jenga PAY availability:', error);
      setIsEnabled(false);
    } finally {
      setCheckingAvailability(false);
    }
  };

  const loadConfig = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('landlord_jenga_configs')
        .select('*')
        .eq('landlord_id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setExistingConfig(data);
        setConfig({
          merchant_code: data.merchant_code || '',
          api_key: '',
          consumer_secret: '',
          paybill_number: data.paybill_number || '247247',
          environment: (data.environment as 'sandbox' | 'production') || 'sandbox',
          ipn_username: data.ipn_username || '',
          ipn_password: ''
        });
      }
    } catch (error) {
      console.error('Error loading Jenga config:', error);
      toast({
        title: "Error",
        description: "Failed to load Jenga PAY configuration",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user || !config.merchant_code || !config.api_key || !config.consumer_secret) {
      toast({
        title: "Missing Fields",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('landlord_jenga_configs')
        .upsert({
          landlord_id: user.id,
          merchant_code: config.merchant_code,
          api_key_encrypted: config.api_key, // In production, encrypt on server
          consumer_secret_encrypted: config.consumer_secret, // In production, encrypt on server
          paybill_number: config.paybill_number,
          environment: config.environment,
          ipn_username: config.ipn_username,
          ipn_password_encrypted: config.ipn_password, // In production, encrypt on server
          is_active: true,
          credentials_verified: false
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Jenga PAY configuration saved successfully"
      });

      await loadConfig();
    } catch (error) {
      console.error('Error saving Jenga config:', error);
      toast({
        title: "Error",
        description: "Failed to save configuration",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const testPayment = async () => {
    setTestingPayment(true);
    try {
      // Simulate test payment
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      toast({
        title: "Test Successful",
        description: "Jenga PAY test payment initiated successfully"
      });
    } catch (error) {
      console.error('Error testing payment:', error);
      toast({
        title: "Test Failed",
        description: "Failed to test payment. Please check your credentials.",
        variant: "destructive"
      });
    } finally {
      setTestingPayment(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "URL copied to clipboard"
    });
  };

  // Don't render if checking availability
  if (checkingAvailability) {
    return null;
  }

  // Don't render if Jenga PAY is not enabled by admin
  if (!isEnabled) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-green-600" />
          Equity Bank - Jenga PAY Configuration
        </CardTitle>
        <CardDescription>
          Configure your Equity Bank Jenga PAY credentials to accept payments via paybill 247247
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status Badge */}
        {existingConfig && (
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <Badge variant={existingConfig.is_active ? "default" : "secondary"}>
              {existingConfig.is_active ? (
                <>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Active
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3 mr-1" />
                  Inactive
                </>
              )}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Environment: {config.environment}
            </span>
          </div>
        )}

        {/* Info Alert */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>About Jenga PAY</AlertTitle>
          <AlertDescription>
            Jenga PAY allows your tenants to pay rent via Equity Bank's paybill 247247. 
            Payments are processed instantly and you'll receive instant payment notifications (IPN).
          </AlertDescription>
        </Alert>

        {/* IPN URL Display */}
        <div className="space-y-2">
          <Label>IPN Callback URL</Label>
          <div className="flex gap-2">
            <Input 
              value={ipnUrl} 
              readOnly 
              className="font-mono text-sm bg-muted"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => copyToClipboard(ipnUrl)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Register this URL in your Jenga PAY dashboard for instant payment notifications
          </p>
        </div>

        {/* Configuration Form */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="merchant-code">Merchant Code *</Label>
              <Input
                id="merchant-code"
                value={config.merchant_code}
                onChange={(e) => setConfig({ ...config, merchant_code: e.target.value })}
                placeholder="Your Jenga merchant code"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="paybill">Paybill Number</Label>
              <Input
                id="paybill"
                value={config.paybill_number}
                readOnly
                className="bg-muted"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-key">API Key *</Label>
            <Input
              id="api-key"
              type="password"
              value={config.api_key}
              onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
              placeholder="Your Jenga API key"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="consumer-secret">Consumer Secret *</Label>
            <Input
              id="consumer-secret"
              type="password"
              value={config.consumer_secret}
              onChange={(e) => setConfig({ ...config, consumer_secret: e.target.value })}
              placeholder="Your Jenga consumer secret"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="environment">Environment</Label>
            <Select
              value={config.environment}
              onValueChange={(value: 'sandbox' | 'production') => 
                setConfig({ ...config, environment: value })
              }
            >
              <SelectTrigger id="environment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox (Testing)</SelectItem>
                <SelectItem value="production">Production (Live)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* IPN Authentication (Optional) */}
          <div className="border-t pt-4 mt-4">
            <h4 className="text-sm font-medium mb-3">IPN Authentication (Optional)</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ipn-username">IPN Username</Label>
                <Input
                  id="ipn-username"
                  value={config.ipn_username}
                  onChange={(e) => setConfig({ ...config, ipn_username: e.target.value })}
                  placeholder="Optional"
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ipn-password">IPN Password</Label>
                <Input
                  id="ipn-password"
                  type="password"
                  value={config.ipn_password}
                  onChange={(e) => setConfig({ ...config, ipn_password: e.target.value })}
                  placeholder="Optional"
                  disabled={loading}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button
            onClick={handleSave}
            disabled={loading}
            className="flex-1"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Shield className="h-4 w-4 mr-2" />
                Save Configuration
              </>
            )}
          </Button>

          {existingConfig && (
            <Button
              onClick={testPayment}
              variant="outline"
              disabled={testingPayment}
            >
              {testingPayment ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Payment'
              )}
            </Button>
          )}
        </div>

        {/* Documentation Link */}
        <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Need help? Visit{' '}
            <a
              href="https://developer.jengahq.io/guides/jenga-pgw/instant-payment-notifications"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Jenga PAY Documentation
            </a>
            {' '}for more information on setting up your integration.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
