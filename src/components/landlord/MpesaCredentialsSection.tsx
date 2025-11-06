import React, { useState, useEffect, useRef, useCallback } from "react";
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
  shortcode_type: 'paybill' | 'till_safaricom' | 'till_kopokopo';
  phone_number?: string;
  paybill_number?: string;
  till_number?: string;
  till_provider?: 'safaricom' | 'kopokopo';
  kopokopo_client_id?: string;
  kopokopo_client_secret?: string;
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
  const hasInitializedRef = useRef(false);
  const hasDraftRef = useRef(false);
  
  // Refs for autofocus
  const consumerKeyRef = useRef<HTMLInputElement>(null);
  const businessShortcodeRef = useRef<HTMLInputElement>(null);
  const kopoTillRef = useRef<HTMLInputElement>(null);
  const kopoClientIdRef = useRef<HTMLInputElement>(null);
  
  const [config, setConfig] = useState<MpesaConfig>({
    consumer_key: '',
    consumer_secret: '',
    passkey: '',
    business_shortcode: '',
    shortcode_type: 'paybill',
    phone_number: '',
    paybill_number: '',
    till_number: '',
    till_provider: 'safaricom',
    kopokopo_client_id: '',
    kopokopo_client_secret: '',
    environment: 'sandbox',
    callback_url: '',
    is_active: true,
  });

  // SessionStorage keys for draft persistence
  const EDIT_KEY = `mpesa_editing_v1_${user?.id || 'guest'}`;
  const DRAFT_KEY = `mpesa_draft_v1_${user?.id || 'guest'}`;
  const DRAFT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

  // Draft persistence helpers
  const loadDraft = () => {
    try {
      const draftStr = sessionStorage.getItem(DRAFT_KEY);
      if (!draftStr) return null;
      const draft = JSON.parse(draftStr);
      if (Date.now() - draft.savedAt > DRAFT_EXPIRY_MS) {
        clearDraft();
        return null;
      }
      return draft.fields;
    } catch {
      return null;
    }
  };

  const saveDraft = (fields: Partial<MpesaConfig>) => {
    try {
      const draft = {
        fields,
        savedAt: Date.now()
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (error) {
      console.error('Failed to save draft:', error);
    }
  };

  const clearDraft = () => {
    sessionStorage.removeItem(EDIT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
  };

  // Load existing config - SECURITY: Only fetch non-sensitive metadata
  const loadConfig = async () => {
    if (!user?.id) return;

    // CRITICAL FIX: Don't reload config while user is editing or has draft to prevent field clearing
    if (showForm || hasDraftRef.current) {
      console.log('Skipping config reload - user is editing or has draft');
      return;
    }

    try {
      // SECURITY: Only select non-sensitive fields, NEVER fetch encrypted credentials
      const { data, error } = await supabase
        .from('landlord_mpesa_configs')
        .select('id, callback_url, environment, is_active, business_shortcode, shortcode_type, till_provider, kopokopo_client_id, till_number')
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
          shortcode_type: (data.shortcode_type || 'paybill') as 'paybill' | 'till_safaricom' | 'till_kopokopo',
          till_provider: (data.till_provider || 'safaricom') as 'safaricom' | 'kopokopo',
          till_number: data.till_number || '',
          kopokopo_client_id: data.kopokopo_client_id || '',
          // Explicitly clear sensitive fields for security
          consumer_key: '',
          consumer_secret: '',
          passkey: '',
          kopokopo_client_secret: ''
        }));
        setHasConfig(true);
        setIsOpen(true);
        
        // Only set showForm to false on initial load
        if (!hasInitializedRef.current) {
          setShowForm(false);
          hasInitializedRef.current = true;
        }
        
        onConfigChange(true);
      } else {
        setHasConfig(false);
        setIsOpen(true);
        
        // Only set showForm to false on initial load
        if (!hasInitializedRef.current) {
          setShowForm(false);
          hasInitializedRef.current = true;
        }
        
        onConfigChange(false);
      }
    } catch (error) {
      console.error('Error loading M-Pesa config:', error);
    }
  };

  useEffect(() => {
    // Restore draft on mount
    const isEditing = sessionStorage.getItem(EDIT_KEY) === '1';
    const draftFields = loadDraft();
    
    if (isEditing && draftFields) {
      console.log('Restoring draft from sessionStorage');
      hasDraftRef.current = true;
      setShowForm(true);
      setIsOpen(true);
      setConfig(prev => ({
        ...prev,
        ...draftFields
      }));
    }
    
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  
  // Autofocus logic when form opens
  useEffect(() => {
    if (showForm && isOpen) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        if (config.shortcode_type === 'till_kopokopo') {
          kopoTillRef.current?.focus();
        } else {
          consumerKeyRef.current?.focus();
        }
      }, 100);
    }
  }, [showForm, isOpen, config.shortcode_type]);

  // Warn before navigation if unsaved changes exist
  useEffect(() => {
    if (!showForm) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [showForm]);

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
        till_provider: 'safaricom',
        kopokopo_client_id: '',
        kopokopo_client_secret: '',
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

    // Validate required fields based on shortcode type
    if (config.shortcode_type === 'till_kopokopo') {
      if (!config.till_number || !config.kopokopo_client_id || !config.kopokopo_client_secret) {
        toast({
          title: "Validation Error",
          description: "Please fill in all required Kopo Kopo credentials: Till Number, Client ID, and Client Secret.",
          variant: "destructive",
        });
        return;
      }
    } else {
      if (!config.consumer_key || !config.consumer_secret || !config.passkey || !config.business_shortcode) {
        toast({
          title: "Validation Error",
          description: "Please fill in all required M-Pesa credentials.",
          variant: "destructive",
        });
        return;
      }
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
          till_number: config.till_number,
          till_provider: config.till_provider,
          kopokopo_client_id: config.kopokopo_client_id,
          kopokopo_client_secret: config.kopokopo_client_secret,
          passkey: config.passkey,
          callback_url: config.callback_url,
          environment: config.environment,
          is_active: config.is_active
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setHasConfig(true);
      setShowForm(false); // Exit form
      setIsOpen(false); // Collapse section to return to main page
      hasDraftRef.current = false;
      clearDraft(); // Clear draft after successful save
      onConfigChange(true);
      
      // Clear sensitive data from local state for security
      setConfig(prev => ({
        ...prev,
        consumer_key: '',
        consumer_secret: '',
        passkey: '',
        kopokopo_client_secret: ''
      }));

      toast({
        title: "Success",
        description: "M-Pesa credentials saved securely.",
      });
      
      // Reload config to refresh summary view with latest data
      await loadConfig();
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
                        onClick={() => {
                          setShowForm(true);
                          setIsOpen(true);
                          sessionStorage.setItem(EDIT_KEY, '1');
                        }}
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
                          <span className="text-blue-600 dark:text-blue-400">Using Shortcode: 4155923</span>
                        </li>
                      </ul>
                      <Button 
                        variant="secondary"
                        className="w-full"
                        onClick={() => {
                          toast({
                            title: "Using Platform Defaults",
                            description: "Tenants can pay via M-Pesa using platform shortcode 4155923",
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
                      <p className="text-xs text-muted-foreground">Payment Type</p>
                      <p className="font-medium flex items-center gap-2">
                        {config.shortcode_type === 'paybill' && 'Paybill Number'}
                        {config.shortcode_type === 'till_safaricom' && 'Till Number - Safaricom'}
                        {config.shortcode_type === 'till_kopokopo' && 'Till Number - Kopo Kopo'}
                        <Badge variant="outline" className="text-xs">
                          {config.shortcode_type === 'paybill' ? 'Paybill' : 'Till'}
                        </Badge>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {config.shortcode_type === 'till_kopokopo' ? 'Till Number' : 'Shortcode'}
                      </p>
                      <p className="font-medium">
                        {config.shortcode_type === 'till_kopokopo' ? config.till_number : config.business_shortcode}
                      </p>
                    </div>
                    {config.shortcode_type === 'till_kopokopo' && (
                      <div>
                        <p className="text-xs text-muted-foreground">Client ID</p>
                        <p className="font-medium">{config.kopokopo_client_id}</p>
                      </div>
                    )}
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
                      onClick={() => {
                        setShowForm(true);
                        setIsOpen(true);
                        sessionStorage.setItem(EDIT_KEY, '1');
                      }}
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

              {/* Shortcode Type Selection - Always show first */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Payment Type *</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Paybill: Business account. Till Safaricom: Direct M-Pesa. Till Kopo Kopo: Payment gateway</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Select 
                  value={config.shortcode_type}
                  onValueChange={(value: 'paybill' | 'till_safaricom' | 'till_kopokopo') => {
                    // Update shortcode_type and till_provider in a single setState
                    const newConfig = {
                      ...config,
                      shortcode_type: value,
                      till_provider: value === 'till_kopokopo' ? 'kopokopo' as const : 'safaricom' as const
                    };
                    setConfig(newConfig);
                    saveDraft(newConfig);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paybill">
                      <div className="flex flex-col">
                        <span className="font-medium">Paybill Number</span>
                        <span className="text-xs text-muted-foreground">Best for businesses collecting rent</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="till_safaricom">
                      <div className="flex flex-col">
                        <span className="font-medium">Till Number - Safaricom Direct</span>
                        <span className="text-xs text-muted-foreground">Direct M-Pesa till from Safaricom</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="till_kopokopo">
                      <div className="flex flex-col">
                        <span className="font-medium">Till Number - Kopo Kopo</span>
                        <span className="text-xs text-muted-foreground">Kopo Kopo payment gateway integration</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose your M-Pesa payment type based on your business setup
                </p>
              </div>

              {/* Conditional credential fields based on payment type */}
              {config.shortcode_type === 'till_kopokopo' ? (
                // Kopo Kopo Till Fields
                <div className="grid grid-cols-1 gap-4 p-4 bg-accent/50 rounded-lg border">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <h3 className="font-medium">Kopo Kopo OAuth Credentials</h3>
                  </div>

                  <div className="space-y-2">
                    <Label>Till Number *</Label>
                    <Input 
                      ref={kopoTillRef}
                      type="text"
                      placeholder="e.g., 855087"
                      value={config.till_number || ''}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setConfig(prev => ({ ...prev, till_number: newValue }));
                        saveDraft({ till_number: newValue });
                      }}
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                      Your Kopo Kopo till number
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Kopo Kopo Client ID *</Label>
                    <Input 
                      ref={kopoClientIdRef}
                      type="text"
                      placeholder="Enter your Kopo Kopo Client ID"
                      value={config.kopokopo_client_id || ''}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setConfig(prev => ({ ...prev, kopokopo_client_id: newValue }));
                        saveDraft({ kopokopo_client_id: newValue });
                      }}
                    />
                    <p className="text-xs text-muted-foreground">Get this from your Kopo Kopo dashboard</p>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>
                        Kopo Kopo Client Secret * {hasConfig && <span className="text-xs text-muted-foreground">(Re-enter to update)</span>}
                      </Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">OAuth client secret from your Kopo Kopo dashboard</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input 
                      type="password"
                      placeholder={hasConfig ? "••••••••••••••••" : "Enter your Kopo Kopo Client Secret"}
                      value={config.kopokopo_client_secret || ''}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setConfig(prev => ({ ...prev, kopokopo_client_secret: newValue }));
                        saveDraft({ kopokopo_client_secret: newValue });
                      }}
                    />
                    <p className="text-xs text-muted-foreground">Encrypted using AES-256-GCM before storage</p>
                  </div>
                  
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mt-2">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
                      <p className="text-xs text-blue-800 dark:text-blue-200">
                        Draft values are temporarily saved in your browser until you save or cancel. Safe to switch tabs to copy credentials.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                // Standard M-Pesa Fields
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
                    ref={consumerKeyRef}
                    type="password"
                    placeholder={hasConfig ? "••••••••••••••••" : "Enter M-Pesa Consumer Key"}
                    value={config.consumer_key}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setConfig(prev => ({ ...prev, consumer_key: newValue }));
                      saveDraft({ consumer_key: newValue });
                    }}
                    autoFocus
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
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setConfig(prev => ({ ...prev, consumer_secret: newValue }));
                      saveDraft({ consumer_secret: newValue });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">Encrypted using AES-256-GCM</p>
                </div>
                
                <div className="space-y-2">
                  <Label>
                    {config.shortcode_type === 'paybill' ? 'Paybill Number' : 'Till Number'} *
                  </Label>
                  <Input 
                    ref={businessShortcodeRef}
                    type="text"
                    placeholder={config.shortcode_type === 'paybill' ? "e.g., 4155923" : "e.g., 5071852"}
                    value={config.business_shortcode}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setConfig(prev => ({ ...prev, business_shortcode: newValue }));
                      saveDraft({ business_shortcode: newValue });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Your {config.shortcode_type === 'paybill' ? 'paybill' : 'till'} number where payments are received
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
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setConfig(prev => ({ ...prev, passkey: newValue }));
                      saveDraft({ passkey: newValue });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">Stored with end-to-end encryption</p>
                </div>
              </div>
              )}
                
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Environment</Label>
                  <Select 
                    value={config.environment}
                    onValueChange={(value: 'sandbox' | 'production') => {
                      setConfig(prev => ({ ...prev, environment: value }));
                      saveDraft({ environment: value });
                    }}
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
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setConfig(prev => ({ ...prev, phone_number: newValue }));
                      saveDraft({ phone_number: newValue });
                    }}
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
                <Button 
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    hasDraftRef.current = false;
                    clearDraft();
                    loadConfig();
                  }}
                  disabled={saving}
                >
                  Cancel
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
                <li>Tenant payments will use platform shortcode (4155923)</li>
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
