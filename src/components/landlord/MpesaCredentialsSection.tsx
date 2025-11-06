import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Shield, CheckCircle, XCircle, Globe, Settings, Info, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  
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
          setHasConfig(true);
          setIsOpen(true);
          setShowForm(false); // Show summary view by default
          onConfigChange(true);
        } else {
          setHasConfig(false);
          setIsOpen(true);
          setShowForm(false); // Show selection view
          onConfigChange(false);
        }
      } catch (error) {
        console.error('Error loading M-Pesa config:', error);
      }
    };

    loadConfig();
  }, [user?.id, onConfigChange]);

  const handleDeleteConfig = async () => {
    if (!user?.id || !config.id) return;
    
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
      setShowForm(false);
      setShowDeleteDialog(false);
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
  };

  const handleSave = async () => {
    if (!user?.id) return;

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
      setShowForm(false); // Return to summary view
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
    <TooltipProvider>
      <div className="space-y-4 border border-border rounded-lg p-4">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-accent rounded">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Shield className="h-5 w-5 text-primary" />
                <h3 className="text-sm font-medium">
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
                    <Globe className="h-3 w-3" />
                    Using Platform Defaults
                  </Badge>
                )}
              </div>
            </div>
          </CollapsibleTrigger>
          
          <CollapsibleContent className="space-y-4 pt-4">
            {/* Initial State - No Configuration */}
            {!hasConfig && !showForm && (
              <div className="space-y-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
                    <div className="text-sm text-blue-800 dark:text-blue-200">
                      <p className="font-medium mb-1">Choose M-Pesa Configuration</p>
                      <p>Configure your own M-Pesa API credentials for direct payments to your account, or use platform defaults.</p>
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  {/* Option 1: Configure Custom Credentials */}
                  <Card className="border-2 hover:border-primary transition-colors cursor-pointer">
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <Shield className="h-5 w-5 text-primary" />
                        <CardTitle className="text-base">My Own M-Pesa</CardTitle>
                      </div>
                      <CardDescription>
                        Tenant payments go directly to your paybill/till number
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm text-muted-foreground mb-4">
                        <li className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                          <span>Direct payments to your account</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                          <span>Full control over your funds</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                          <span>Instant settlement</span>
                        </li>
                      </ul>
                      <Button 
                        onClick={() => setShowForm(true)}
                        className="w-full"
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        Configure Custom Credentials
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Option 2: Platform Defaults */}
                  <Card className="border-2 hover:border-primary transition-colors cursor-pointer">
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <Globe className="h-5 w-5 text-primary" />
                        <CardTitle className="text-base">Platform Defaults</CardTitle>
                      </div>
                      <CardDescription>
                        Use system-wide M-Pesa configuration
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm text-muted-foreground mb-4">
                        <li className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                          <span>Quick setup, no API keys needed</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                          <span>Platform manages integration</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                          <span className="text-blue-600 dark:text-blue-400">Using Shortcode: 174379</span>
                        </li>
                      </ul>
                      <Button 
                        variant="secondary"
                        className="w-full"
                        onClick={() => {
                          toast({
                            title: "Using Platform Defaults",
                            description: "Tenants can pay via M-Pesa using platform shortcode 174379",
                          });
                        }}
                      >
                        <Globe className="h-4 w-4 mr-2" />
                        Continue with Defaults
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {/* Configured State - Summary View */}
            {hasConfig && !showForm && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-green-600" />
                        Custom M-Pesa Configuration Active
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Tenant payments go directly to your account
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4 p-4 bg-accent rounded-lg">
                    <div>
                      <p className="text-xs text-muted-foreground">Shortcode Type</p>
                      <p className="font-medium">
                        {config.shortcode_type === 'paybill' ? 'Paybill Number' : 'Till Number'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Shortcode</p>
                      <p className="font-medium">{config.business_shortcode}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Environment</p>
                      <p className="font-medium capitalize">{config.environment}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <Badge variant={config.is_active ? "default" : "secondary"}>
                        {config.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>

                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
                      <div className="text-sm text-amber-800 dark:text-amber-200">
                        <p className="font-medium">Credentials Encrypted</p>
                        <p>API credentials are stored using AES-256-GCM encryption and never displayed.</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button 
                      variant="default"
                      onClick={() => setShowForm(true)}
                      className="flex-1"
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Edit Credentials
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => setShowDeleteDialog(true)}
                      className="flex-1"
                    >
                      <Globe className="h-4 w-4 mr-2" />
                      Switch to Platform Defaults
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Form State - Edit/Create Credentials */}
            {showForm && (
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
                  <div className="flex items-center gap-2">
                    <Label>
                      Consumer Key * {hasConfig && <span className="text-xs text-muted-foreground">(Re-enter to update)</span>}
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Get this from your M-Pesa Daraja Portal under "Apps"</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input 
                    type="password"
                    placeholder={hasConfig ? "••••••••••••••••" : "Enter M-Pesa Consumer Key"}
                    value={config.consumer_key}
                    onChange={(e) => setConfig(prev => ({ ...prev, consumer_key: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">Never shared or stored in plain text</p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>
                      Consumer Secret * {hasConfig && <span className="text-xs text-muted-foreground">(Re-enter to update)</span>}
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Secret key from M-Pesa Daraja Portal - keep this secure</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input 
                    type="password"
                    placeholder={hasConfig ? "••••••••••••••••" : "Enter M-Pesa Consumer Secret"}
                    value={config.consumer_secret}
                    onChange={(e) => setConfig(prev => ({ ...prev, consumer_secret: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">Encrypted using AES-256-GCM</p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>Shortcode Type *</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Paybill: Business account. Till: Personal/shop till number</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Select 
                    value={config.shortcode_type}
                    onValueChange={(value: 'paybill' | 'till') => 
                      setConfig(prev => ({ ...prev, shortcode_type: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paybill">Paybill Number</SelectItem>
                      <SelectItem value="till">Till Number</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Select whether this is a paybill or till number
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label>
                    {config.shortcode_type === 'paybill' ? 'Paybill Number' : 'Till Number'} *
                  </Label>
                  <Input 
                    type="text"
                    placeholder={config.shortcode_type === 'paybill' ? "e.g., 174379" : "e.g., 5071852"}
                    value={config.business_shortcode}
                    onChange={(e) => setConfig(prev => ({ ...prev, business_shortcode: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Your {config.shortcode_type} number where tenant payments will be received directly
                  </p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>
                      Passkey * {hasConfig && <span className="text-xs text-muted-foreground">(Re-enter to update)</span>}
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">STK Push passkey from M-Pesa Daraja Portal</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input 
                    type="password"
                    placeholder={hasConfig ? "••••••••••••••••••••••••" : "Enter M-Pesa Passkey"}
                    value={config.passkey}
                    onChange={(e) => setConfig(prev => ({ ...prev, passkey: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">Stored with end-to-end encryption</p>
                </div>
                
                <div className="space-y-2">
                  <Label>Environment</Label>
                  <Select 
                    value={config.environment}
                    onValueChange={(value: 'sandbox' | 'production') => 
                      setConfig(prev => ({ ...prev, environment: value }))
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
                    {testing ? 'Testing...' : 'Test STK Push'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Switch to Platform Defaults?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will delete your custom M-Pesa configuration and switch to platform defaults.</p>
              <p className="font-medium">What this means:</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Your API credentials will be permanently deleted</li>
                <li>Tenant payments will use platform shortcode (174379)</li>
                <li>You can reconfigure your own credentials anytime</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteConfig}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? "Switching..." : "Switch to Defaults"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </TooltipProvider>
  );
};
