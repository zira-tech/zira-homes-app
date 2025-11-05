import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Send, Copy, Mail, MessageSquare, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery } from "@tanstack/react-query";

interface ResendCredentialsDialogProps {
  tenant: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    phone: string;
  };
  children: React.ReactNode;
}

export function ResendCredentialsDialog({ tenant, children }: ResendCredentialsDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendingSMS, setResendingSMS] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  // Check SMS provider status
  const { data: smsStatus, isLoading: smsStatusLoading } = useQuery({
    queryKey: ['sms-provider-status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sms_providers')
        .select('is_active, provider_name')
        .eq('is_active', true)
        .maybeSingle();
      
      return {
        available: !!data,
        providerName: data?.provider_name || 'Unknown'
      };
    },
    staleTime: 60000, // Cache for 1 minute
  });

  const generateNewPassword = () => {
    // Enhanced password generation matching backend
    const lowercase = "abcdefghijkmnpqrstuvwxyz";
    const uppercase = "ABCDEFGHIJKLMNPQRSTUVWXYZ";
    const numbers = "23456789";
    const symbols = "!@#$%&*";
    
    let password = "";
    
    // Ensure at least one character from each category
    password += lowercase.charAt(Math.floor(Math.random() * lowercase.length));
    password += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
    password += numbers.charAt(Math.floor(Math.random() * numbers.length));
    password += symbols.charAt(Math.floor(Math.random() * symbols.length));
    
    // Fill remaining positions (12 total)
    const allChars = lowercase + uppercase + numbers + symbols;
    for (let i = 0; i < 8; i++) {
      password += allChars.charAt(Math.floor(Math.random() * allChars.length));
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  };

  const [newPassword] = useState(generateNewPassword());

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Login details copied to clipboard",
    });
  };

  const resendEmail = async () => {
    setResendingEmail(true);
    try {
      const { error } = await supabase.functions.invoke('send-welcome-email', {
        body: {
          tenantEmail: tenant.email,
          tenantName: `${tenant.first_name} ${tenant.last_name}`,
          propertyName: 'Your Property',
          unitNumber: 'Your Unit',
          temporaryPassword: newPassword,
          loginUrl: 'https://zirahomes.com/auth'
        }
      });

      if (error) {
        throw error;
      }

      toast({
        title: "Email Sent",
        description: "Welcome email resent successfully",
      });
    } catch (error) {
      console.error("Error resending email:", error);
      toast({
        title: "Email Failed",
        description: "Failed to resend welcome email. Please share credentials manually.",
        variant: "destructive",
      });
    } finally {
      setResendingEmail(false);
    }
  };

  const resendSMS = async () => {
    setResendingSMS(true);
    try {
      // First, try to get the SMS provider configuration from database
      let smsConfig;
      
      try {
        const { data: providerData, error: providerError } = await supabase
          .from('sms_providers')
          .select('*')
          .eq('is_active', true)
          .eq('is_default', true)
          .single();
        
        if (!providerError && providerData) {
          smsConfig = {
            provider_name: providerData.provider_name,
            base_url: providerData.base_url,
            username: providerData.username,
            unique_identifier: providerData.unique_identifier,
            sender_id: providerData.sender_id,
            sender_type: providerData.sender_type,
            authorization_token: providerData.authorization_token,
            config_data: providerData.config_data
          };
        } else {
          throw new Error("No SMS provider configured");
        }
      } catch (configError) {
        console.log("Using fallback SMS configuration");
        // Fallback configuration
        smsConfig = {
          provider_name: "InHouse SMS",
          base_url: "http://68.183.101.252:803/bulk_api/",
          username: "ZIRA TECH",
          unique_identifier: "77",
          sender_id: "ZIRA TECH",
          sender_type: "10",
          authorization_token: "your-default-token"
        };
      }

      // Enhanced SMS message template
      const smsMessage = `🏠 Zira Homes - New Login Details

📧 Email: ${tenant.email}
🔑 Password: ${newPassword}
🌐 Login: https://zirahomes.com/auth

Please change your password after first login.

Need help? Contact support.`;

      const { data: smsResult, error } = await supabase.functions.invoke('send-sms-with-logging', {
        body: {
          provider_name: smsConfig.provider_name,
          phone_number: tenant.phone,
          message: smsMessage,
          landlord_id: user?.id,
          provider_config: smsConfig
        }
      });

      if (error) {
        throw error;
      }

      toast({
        title: "SMS Sent Successfully",
        description: `New login credentials sent to ${tenant.phone}`,
      });
    } catch (error: any) {
      console.error("Error resending SMS:", error);
      
      // Enhanced error handling with specific messages
      let errorMessage = "Failed to send SMS. ";
      
      if (error.message?.includes('Invalid phone number')) {
        errorMessage += "Please check the phone number format.";
      } else if (error.message?.includes('authentication token')) {
        errorMessage += "SMS provider not configured properly.";
      } else if (error.message?.includes('Rate Limited')) {
        errorMessage += "Too many messages sent. Please try again later.";
      } else {
        errorMessage += "Please share credentials manually.";
      }
      
      toast({
        title: "SMS Delivery Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setResendingSMS(false);
    }
  };

  const smsAvailable = smsStatus?.available && !smsStatusLoading;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] bg-card">
        <DialogHeader>
          <DialogTitle className="text-primary">Resend Login Credentials</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* SMS Provider Status Indicator */}
          <div className="flex items-center gap-2">
            {smsStatusLoading ? (
              <Badge variant="outline" className="text-xs">
                <AlertCircle className="h-3 w-3 mr-1" />
                Checking SMS status...
              </Badge>
            ) : smsAvailable ? (
              <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/20">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                SMS Available ({smsStatus.providerName})
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/20">
                <XCircle className="h-3 w-3 mr-1" />
                SMS Unavailable - Email only
              </Badge>
            )}
          </div>

          <div className="bg-muted/50 p-4 rounded-lg">
            <h4 className="font-medium text-primary mb-2">Tenant Details</h4>
            <p className="text-sm text-muted-foreground">
              <strong>Name:</strong> {tenant.first_name} {tenant.last_name}
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Email:</strong> {tenant.email}
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Phone:</strong> {tenant.phone || 'Not provided'}
            </p>
          </div>

          <div className="bg-accent/10 p-4 rounded-lg border border-accent/20">
            <h4 className="font-medium text-primary mb-3">New Login Credentials</h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Email:</span>
                <code className="text-sm bg-muted px-2 py-1 rounded">{tenant.email}</code>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Password:</span>
                <code className="text-sm bg-muted px-2 py-1 rounded">{newPassword}</code>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => copyToClipboard(`Email: ${tenant.email}\nPassword: ${newPassword}\nLogin: https://zirahomes.com/auth`)}
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy All Details
            </Button>
          </div>

          <div className="space-y-3">
            <h4 className="font-medium text-primary">Resend Options</h4>
            
            <Button
              onClick={resendEmail}
              disabled={resendingEmail}
              className="w-full"
              variant="outline"
            >
              <Mail className="w-4 h-4 mr-2" />
              {resendingEmail ? "Sending..." : "Resend via Email"}
            </Button>

            <Button
              onClick={resendSMS}
              disabled={resendingSMS || !tenant.phone || !smsAvailable}
              className="w-full"
              variant="outline"
              title={!smsAvailable ? "SMS provider not configured" : !tenant.phone ? "No phone number" : ""}
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              {resendingSMS ? "Sending..." : "Resend via SMS"}
            </Button>
          </div>

          {!tenant.phone && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No phone number available for this tenant. SMS cannot be sent.
              </AlertDescription>
            </Alert>
          )}
          
          {!smsAvailable && tenant.phone && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                SMS provider not configured. Please contact your administrator or use email/manual sharing.
              </AlertDescription>
            </Alert>
          )}

          <div className="bg-destructive/10 p-3 rounded-lg border border-destructive/20">
            <p className="text-xs text-destructive">
              <strong>Note:</strong> This will generate a new temporary password. The old password will no longer work after the tenant logs in with the new one.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}