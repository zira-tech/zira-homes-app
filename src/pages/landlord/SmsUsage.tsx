import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessageSquare, TrendingUp, DollarSign, Clock, CheckCircle, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { FeatureGate } from "@/components/ui/feature-gate";
import { FEATURES } from "@/hooks/usePlanFeatureAccess";

interface SmsLog {
  id: string;
  phone_number: string;
  message_type: string;
  status: string;
  provider_name: string;
  created_at: string;
  error_message?: string;
}

interface SmsStats {
  total_sent: number;
  total_failed: number;
  total_pending: number;
  total_cost: number;
}

const SmsUsage = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [stats, setStats] = useState<SmsStats>({
    total_sent: 0,
    total_failed: 0,
    total_pending: 0,
    total_cost: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadSmsData();
    }
  }, [user]);

  const loadSmsData = async () => {
    try {
      setLoading(true);

      // Load SMS logs for current month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { data: logsData, error: logsError } = await supabase
        .from('sms_logs')
        .select('*')
        .gte('created_at', startOfMonth.toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      if (logsError) throw logsError;

      setLogs(logsData || []);

      // Calculate stats
      const sent = logsData?.filter(log => log.status === 'sent').length || 0;
      const failed = logsData?.filter(log => log.status === 'failed').length || 0;
      const pending = logsData?.filter(log => log.status === 'pending').length || 0;

      setStats({
        total_sent: sent,
        total_failed: failed,
        total_pending: pending,
        total_cost: (sent + failed) * 2.5 // KES 2.50 per SMS
      });

    } catch (error) {
      console.error('Error loading SMS data:', error);
      toast.error("Failed to load SMS usage data");
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sent':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return <Badge variant="default" className="bg-green-500">Sent</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

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
          fallbackTitle="SMS Usage & Analytics"
          fallbackDescription="Track your SMS delivery, monitor costs, and analyze messaging patterns with detailed usage reports."
          allowReadOnly={false}
        >
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold">SMS Usage</h1>
              <p className="text-muted-foreground">Monitor your SMS delivery and costs</p>
            </div>
            <Button onClick={loadSmsData} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>

          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Sent</CardTitle>
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total_sent}</div>
                <p className="text-xs text-muted-foreground">This month</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Failed</CardTitle>
                <XCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-500">{stats.total_failed}</div>
                <p className="text-xs text-muted-foreground">Delivery failures</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.total_sent + stats.total_failed > 0
                    ? Math.round((stats.total_sent / (stats.total_sent + stats.total_failed)) * 100)
                    : 0}%
                </div>
                <p className="text-xs text-muted-foreground">Delivery success</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">KES {stats.total_cost.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">This month</p>
              </CardContent>
            </Card>
          </div>

          {/* Recent SMS Logs */}
          <Card>
            <CardHeader>
              <CardTitle>Recent SMS Activity</CardTitle>
              <CardDescription>Last 50 SMS sent this month</CardDescription>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <div className="text-center py-12">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-medium mb-2">No SMS Activity</h3>
                  <p className="text-muted-foreground">
                    You haven't sent any SMS messages this month.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {logs.map((log) => (
                    <div key={log.id} className="flex items-start justify-between border-b pb-3 last:border-0">
                      <div className="flex items-start gap-3">
                        {getStatusIcon(log.status)}
                        <div>
                          <p className="font-medium">To: {log.phone_number}</p>
                          <p className="text-sm text-muted-foreground capitalize">
                            {log.message_type} • {log.provider_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                          </p>
                          {log.error_message && (
                            <p className="text-xs text-red-500 mt-1">Error: {log.error_message}</p>
                          )}
                        </div>
                      </div>
                      {getStatusBadge(log.status)}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </FeatureGate>
      </div>
    </DashboardLayout>
  );
};

export default SmsUsage;
