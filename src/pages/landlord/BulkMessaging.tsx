import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { useSmsCredits } from "@/hooks/useSmsCredits";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send, Users, Filter, MessageSquare, AlertTriangle, CreditCard } from "lucide-react";
import { FeatureGate } from "@/components/ui/feature-gate";
import { FEATURES } from "@/hooks/usePlanFeatureAccess";
import { useNavigate } from "react-router-dom";

interface Tenant {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

interface Property {
  id: string;
  name: string;
}

const BulkMessaging = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { balance: smsCredits, isLow: isLowCredits } = useSmsCredits();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedTenants, setSelectedTenants] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [propertyFilter, setPropertyFilter] = useState<string>("all");

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load properties
      const { data: propertiesData, error: propError } = await supabase
        .from('properties')
        .select('id, name')
        .eq('owner_id', user?.id)
        .order('name');

      if (propError) throw propError;
      setProperties(propertiesData || []);

      // Get property IDs
      const propertyIds = propertiesData?.map(p => p.id) || [];

      if (propertyIds.length === 0) {
        setTenants([]);
        setLoading(false);
        return;
      }

      // Load tenants with active leases - simplified query
      const { data: leasesData, error: leasesError } = await supabase
        .from('leases')
        .select(`
          tenant_id,
          tenants (
            id,
            first_name,
            last_name,
            email,
            phone
          ),
          units!inner (
            property_id
          )
        `)
        .eq('status', 'active')
        .in('units.property_id', propertyIds);

      if (leasesError) {
        console.error('Error loading leases:', leasesError);
        throw leasesError;
      }

      // Extract and deduplicate tenants
      const tenantsMap = new Map<string, Tenant>();
      leasesData?.forEach((lease: any) => {
        if (lease.tenants) {
          const tenant = lease.tenants;
          if (!tenantsMap.has(tenant.id)) {
            tenantsMap.set(tenant.id, {
              id: tenant.id,
              first_name: tenant.first_name,
              last_name: tenant.last_name,
              email: tenant.email,
              phone: tenant.phone
            });
          }
        }
      });

      const uniqueTenants = Array.from(tenantsMap.values());
      console.log(`✅ Loaded ${uniqueTenants.length} unique tenants from ${leasesData?.length || 0} active leases`);
      
      setTenants(uniqueTenants);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error("Failed to load tenants");
    } finally {
      setLoading(false);
    }
  };

  const toggleTenant = (tenantId: string) => {
    const newSelected = new Set(selectedTenants);
    if (newSelected.has(tenantId)) {
      newSelected.delete(tenantId);
    } else {
      newSelected.add(tenantId);
    }
    setSelectedTenants(newSelected);
  };

  const selectAll = () => {
    const filtered = getFilteredTenants();
    setSelectedTenants(new Set(filtered.map(t => t.id)));
  };

  const deselectAll = () => {
    setSelectedTenants(new Set());
  };

  const getFilteredTenants = () => {
    // Filter logic would go here based on propertyFilter
    return tenants;
  };

  const handleSend = async () => {
    if (selectedTenants.size === 0) {
      toast.error("Please select at least one recipient");
      return;
    }

    if (!message.trim()) {
      toast.error("Please enter a message");
      return;
    }

    // Check SMS credits
    if (smsCredits < selectedTenants.size) {
      toast.error(`Insufficient SMS credits. You have ${smsCredits} credits but need ${selectedTenants.size}.`);
      return;
    }

    if (message.length > 160) {
      toast.warning("Message is longer than 160 characters and will be sent as multiple SMS");
    }

    try {
      setSending(true);

      const selectedTenantsList = tenants.filter(t => selectedTenants.has(t.id));
      let successCount = 0;
      let failCount = 0;

      for (const tenant of selectedTenantsList) {
        if (!tenant.phone) {
          failCount++;
          continue;
        }

        try {
          const { error } = await supabase.functions.invoke('send-sms-with-logging', {
            body: {
              phone_number: tenant.phone,
              message: message.replace('{tenant_name}', `${tenant.first_name} ${tenant.last_name}`),
              message_type: 'bulk'
            }
          });

          if (error) {
            console.error(`Failed to send to ${tenant.phone}:`, error);
            failCount++;
          } else {
            successCount++;
          }
        } catch (error) {
          console.error(`Error sending to ${tenant.phone}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`Successfully sent ${successCount} SMS messages`);
      }
      if (failCount > 0) {
        toast.error(`Failed to send ${failCount} messages`);
      }

      setMessage("");
      setSelectedTenants(new Set());
    } catch (error) {
      console.error('Error sending bulk SMS:', error);
      toast.error("Failed to send bulk SMS");
    } finally {
      setSending(false);
    }
  };

  const estimatedCost = selectedTenants.size * 2.5; // KES 2.50 per SMS

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto p-3 sm:p-4 lg:p-6 space-y-6">
        <FeatureGate
          feature={FEATURES.SMS_NOTIFICATIONS}
          fallbackTitle="Bulk SMS Messaging"
          fallbackDescription="Send SMS notifications to multiple tenants at once. Keep your tenants informed with automated and manual communications."
          allowReadOnly={false}
        >
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold">Bulk SMS Messaging</h1>
            <p className="text-muted-foreground">Send SMS to multiple tenants at once</p>
          </div>

          {/* Low Credits Warning */}
          {isLowCredits && (
            <Alert className="border-orange-200 bg-orange-50">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>
                  Low SMS credits ({smsCredits} remaining). Purchase more to continue messaging.
                </span>
                <Button size="sm" onClick={() => navigate('/billing')}>
                  <CreditCard className="h-4 w-4 mr-2" />
                  Buy Credits
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Recipient Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Select Recipients</span>
                  <Badge variant="secondary">
                    {selectedTenants.size} selected
                  </Badge>
                </CardTitle>
                <CardDescription>Choose tenants to receive the message</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={selectAll}>
                    Select All
                  </Button>
                  <Button size="sm" variant="outline" onClick={deselectAll}>
                    Deselect All
                  </Button>
                </div>

                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {tenants.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No tenants with active leases found</p>
                      <p className="text-sm">Add tenants with active leases to send SMS</p>
                    </div>
                  ) : (
                    tenants.map((tenant) => (
                      <div
                        key={tenant.id}
                        className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent cursor-pointer"
                        onClick={() => toggleTenant(tenant.id)}
                      >
                        <Checkbox
                          checked={selectedTenants.has(tenant.id)}
                          onCheckedChange={() => toggleTenant(tenant.id)}
                        />
                        <div className="flex-1">
                          <p className="font-medium">
                            {tenant.first_name} {tenant.last_name}
                          </p>
                          <p className="text-sm text-muted-foreground">{tenant.phone || 'No phone'}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Message Composer */}
            <Card>
              <CardHeader>
                <CardTitle>Compose Message</CardTitle>
                <CardDescription>Write your SMS message (max 160 characters recommended)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type your message here... Use {tenant_name} to personalize"
                    rows={8}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{message.length} characters</span>
                    <span>{Math.ceil(message.length / 160)} SMS</span>
                  </div>
                </div>

                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Recipients:</span>
                    <span className="font-medium">{selectedTenants.size}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>SMS Credits Available:</span>
                    <span className={`font-medium ${smsCredits < selectedTenants.size ? 'text-red-500' : ''}`}>
                      {smsCredits}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Credits Required:</span>
                    <span className="font-medium">{selectedTenants.size}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Estimated Cost:</span>
                    <span className="font-medium">KES {estimatedCost.toFixed(2)}</span>
                  </div>
                </div>

                <Button
                  onClick={handleSend}
                  disabled={sending || selectedTenants.size === 0 || !message.trim()}
                  className="w-full"
                >
                  <Send className="h-4 w-4 mr-2" />
                  {sending ? 'Sending...' : `Send to ${selectedTenants.size} ${selectedTenants.size === 1 ? 'Tenant' : 'Tenants'}`}
                </Button>
              </CardContent>
            </Card>
          </div>
        </FeatureGate>
      </div>
    </DashboardLayout>
  );
};

export default BulkMessaging;
