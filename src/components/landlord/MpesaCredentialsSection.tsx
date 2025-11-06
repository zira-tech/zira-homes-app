import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Shield, CheckCircle, XCircle, Zap, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface MpesaConfig {
  id?: string;
  consumer_key: string;
  consumer_secret: string;
  passkey: string;
  business_shortcode: string;
  shortcode_type: 'paybill' | 'till';
  phone_number?: string;
  paybill_number?: string;
  till_number?: string;
  environment: 'sandbox' | 'production';
  callback_url?: string;
  is_active: boolean;
}

interface MpesaCredentialsSectionProps {
  onConfigChange: (hasConfig: boolean) => void;
}

export const MpesaCredentialsSection: React.FC<MpesaCredentialsSectionProps> = ({ onConfigChange }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [usePlatformDefaults, setUsePlatformDefaults] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  
  const [config, setConfig] = useState<MpesaConfig>({
    consumer_key: '',
    consumer_secret: '',
    passkey: '',
    business_shortcode: '',
    shortcode_type: 'paybill',
    phone_number: '',
    paybill_number: '',
    till_number: '',
    environment: 'sandbox',
    callback_url: '',
    is_active: true,
  });

  // Load existing config - SECURITY: Only fetch non-sensitive metadata
  useEffect(() => {
    const loadConfig = async () => {
      if (!user?.id) return;

      try {
        // SECURITY: Only select non-sensitive fields, NEVER fetch encrypted credentials
        const { data, error } = await supabase
          .from('landlord_mpesa_configs')
          .select('id, callback_url, environment, is_active, business_shortcode, shortcode_type')
          .eq('landlord_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error loading M-Pesa config:', error);
          return;
        }

        if (data) {
          // SECURITY: Never populate credential fields from database
          // Users must re-enter credentials to update them
          setConfig(prev => ({
            ...prev,
            id: data.id,
            callback_url: data.callback_url || '',
            environment: (data.environment === 'production' ? 'production' : 'sandbox') as 'sandbox' | 'production',
            is_active: data.is_active,
            business_shortcode: data.business_shortcode || '',
            shortcode_type: (data.shortcode_type || 'paybill') as 'paybill' | 'till',
            // Explicitly clear sensitive fields for security
            consumer_key: '',
            consumer_secret: '',
            passkey: ''
          }));
          setUsePlatformDefaults(false);
          setHasConfig(true);
          setIsOpen(true);
          onConfigChange(true);
        } else {
          setHasConfig(false);
          setIsOpen(true);
          onConfigChange(false);
        }
      } catch (error) {
        console.error('Error loading M-Pesa config:', error);
      }
    };

    loadConfig();
  }, [user?.id, onConfigChange]);

  const handleSave = async () => {
    if (!user?.id) return;
    
    if (usePlatformDefaults) {
      // Delete custom config if switching to platform defaults
      if (config.id) {
        setSaving(true);
        try {
          const { error } = await supabase
            .from('landlord_mpesa_configs')
            .delete()
            .eq('id', config.id);

          if (error) throw error;

          setConfig({
            consumer_key: '',
            consumer_secret: '',
            passkey: '',
            business_shortcode: '',
            shortcode_type: 'paybill',
            phone_number: '',
            paybill_number: '',
            till_number: '',
            environment: 'sandbox',
            callback_url: '',
            is_active: true,
          });
          setHasConfig(false);
          onConfigChange(false);

          toast({
            title: "Success",
            description: "Switched to platform default M-Pesa configuration.",
          });
        } catch (error) {
          console.error('Error deleting config:', error);
          toast({
            title: "Error", 
            description: "Failed to switch to platform defaults.",
            variant: "destructive",
          });
        } finally {
          setSaving(false);
        }
      }
      return;
    }

    // Validate required fields
    if (!config.consumer_key || !config.consumer_secret || !config.passkey || !config.business_shortcode) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required M-Pesa credentials.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // Save encrypted credentials via edge function
      const { data, error } = await supabase.functions.invoke('save-mpesa-credentials', {
        body: {
          consumer_key: config.consumer_key,
          consumer_secret: config.consumer_secret,
          shortcode: config.business_shortcode,
          shortcode_type: config.shortcode_type,
          passkey: config.passkey,
          callback_url: config.callback_url,
          environment: config.environment,
          is_active: config.is_active
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setHasConfig(true);
      onConfigChange(true);
      
      // Clear sensitive data from local state for security
      setConfig(prev => ({
        ...prev,
        consumer_key: '',
        consumer_secret: '',
        passkey: ''
      }));

      toast({
        title: "Success",
        description: "M-Pesa credentials saved securely.",
      });
    } catch (error: any) {
      console.error('Error saving M-Pesa config:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save M-Pesa credentials.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestSTK = async () => {
    if (!config.phone_number) {
      toast({
        title: "Test Error",
        description: "Please enter a phone number to test STK Push.",
        variant: "destructive",
      });
      return;
    }

    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
        body: {
          phone: config.phone_number,
          amount: 1, // Test with 1 KES
          accountReference: 'TEST-STK',
          transactionDesc: 'Test STK Push',
          landlordId: user?.id,
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Test Successful",
          description: `STK Push sent successfully using shortcode ${data.data?.BusinessShortCode}! Check your phone.`,
        });
      } else {
        throw new Error(data?.error || 'Test failed');
      }
    } catch (error) {
      console.error('STK test error:', error);
      toast({
        title: "Test Failed",
        description: "Failed to send test STK Push. Please check your credentials.",
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Shield className="h-5 w-5 text-blue-600" />
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                M-Pesa API Credentials
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {hasConfig ? (
                <Badge variant="default" className="gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <XCircle className="h-3 w-3" />
                  Not Configured
                </Badge>
              )}
            </div>
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent className="space-y-4 pt-4">
          {/* Informational alert */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div className="text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium mb-1">M-Pesa Integration</p>
                <p>Configure your own M-Pesa credentials so tenant payments go directly to your paybill/till number. Without this, payments will use platform defaults.</p>
              </div>
            </div>
          </div>

          {/* Platform Defaults Toggle */}
          <div className="flex items-center justify-between py-2">
            <div className="space-y-1">
              <Label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Use Platform Defaults
              </Label>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Use system-wide M-Pesa configuration instead of your own credentials
              </p>
            </div>
            <Switch 
              checked={usePlatformDefaults}
              onCheckedChange={setUsePlatformDefaults}
              className="data-[state=checked]:bg-blue-600"
            />
          </div>

          {!usePlatformDefaults && (
            <div className="space-y-4">
              {/* SECURITY NOTICE */}
              {hasConfig && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4">
                  <div className="flex items-start gap-2">
                    <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
                    <div className="text-sm text-amber-800 dark:text-amber-200">
                      <p className="font-medium">Credentials are encrypted</p>
                      <p>For security, stored credentials are never displayed. Re-enter credentials to update them.</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Consumer Key * {hasConfig && <span className="text-xs text-muted-foreground">(Re-enter to update)</span>}
                  </Label>
                  <Input 
                    type="password"
                    placeholder={hasConfig ? "••••••••••••••••" : "Enter M-Pesa Consumer Key"}
                    value={config.consumer_key}
                    onChange={(e) => setConfig(prev => ({ ...prev, consumer_key: e.target.value }))}
                    className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                  />
                  <p className="text-xs text-muted-foreground">Never shared or stored in plain text</p>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Consumer Secret * {hasConfig && <span className="text-xs text-muted-foreground">(Re-enter to update)</span>}
                  </Label>
                  <Input 
                    type="password"
                    placeholder={hasConfig ? "••••••••••••••••" : "Enter M-Pesa Consumer Secret"}
                    value={config.consumer_secret}
                    onChange={(e) => setConfig(prev => ({ ...prev, consumer_secret: e.target.value }))}
                    className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                  />
                  <p className="text-xs text-muted-foreground">Encrypted using AES-256-GCM</p>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Shortcode Type *
                  </Label>
                  <Select 
                    value={config.shortcode_type}
                    onValueChange={(value: 'paybill' | 'till') => 
                      setConfig(prev => ({ ...prev, shortcode_type: value }))
                    }
                  >
                    <SelectTrigger className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paybill">Paybill Number</SelectItem>
                      <SelectItem value="till">Till Number</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Select whether this is a paybill or till number
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {config.shortcode_type === 'paybill' ? 'Paybill Number' : 'Till Number'} *
                  </Label>
                  <Input 
                    type="text"
                    placeholder={config.shortcode_type === 'paybill' ? "e.g., 174379" : "e.g., 5071852"}
                    value={config.business_shortcode}
                    onChange={(e) => setConfig(prev => ({ ...prev, business_shortcode: e.target.value }))}
                    className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Your {config.shortcode_type} number where tenant payments will be received directly
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Passkey * {hasConfig && <span className="text-xs text-muted-foreground">(Re-enter to update)</span>}
                  </Label>
                  <Input 
                    type="password"
                    placeholder={hasConfig ? "••••••••••••••••••••••••" : "Enter M-Pesa Passkey"}
                    value={config.passkey}
                    onChange={(e) => setConfig(prev => ({ ...prev, passkey: e.target.value }))}
                    className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                  />
                  <p className="text-xs text-muted-foreground">Stored with end-to-end encryption</p>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Environment
                  </Label>
                  <Select 
                    value={config.environment}
                    onValueChange={(value: 'sandbox' | 'production') => 
                      setConfig(prev => ({ ...prev, environment: value }))
                    }
                  >
                    <SelectTrigger className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sandbox">Sandbox (Testing)</SelectItem>
                      <SelectItem value="production">Production (Live)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Test Phone Number
                  </Label>
                  <Input 
                    type="tel"
                    placeholder="+254701234567"
                    value={config.phone_number || ''}
                    onChange={(e) => setConfig(prev => ({ ...prev, phone_number: e.target.value }))}
                    className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button 
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {saving ? 'Saving...' : 'Save Credentials'}
                </Button>
                
                {hasConfig && config.phone_number && (
                  <Button 
                    onClick={handleTestSTK}
                    disabled={testing}
                    variant="outline"
                    className="gap-2"
                  >
                    <Zap className="h-4 w-4" />
                    {testing ? 'Testing...' : 'Test STK Push'}
                  </Button>
                )}
              </div>
            </div>
          )}

          {usePlatformDefaults && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Using platform default M-Pesa configuration. Your tenants can make payments using the system's M-Pesa integration, but payments will go to the platform's paybill/till number first.
              </p>
              <Button 
                onClick={handleSave}
                disabled={saving}
                className="mt-3 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
