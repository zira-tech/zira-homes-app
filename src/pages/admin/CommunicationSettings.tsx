import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SMSProviderConfig from "@/components/admin/SMSProviderConfig";
import WhatsAppBusinessConfig from "@/components/admin/WhatsAppBusinessConfig";
import { SMSHealthCheck } from "@/components/admin/SMSHealthCheck";
import { DashboardLayout } from "@/components/DashboardLayout";

const CommunicationSettings = () => {
  return (
    <DashboardLayout>
      <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Communication Settings</h1>
        <p className="text-muted-foreground">
          Configure SMS providers, WhatsApp Business, and monitor communication health
        </p>
      </div>

      <Tabs defaultValue="sms" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="sms">SMS Configuration</TabsTrigger>
          <TabsTrigger value="health">SMS Health Check</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp Business</TabsTrigger>
        </TabsList>
        
        <TabsContent value="sms" className="space-y-4">
          <SMSProviderConfig />
        </TabsContent>
        
        <TabsContent value="health" className="space-y-4">
          <SMSHealthCheck />
        </TabsContent>
        
        <TabsContent value="whatsapp" className="space-y-4">
          <WhatsAppBusinessConfig />
        </TabsContent>
      </Tabs>
    </div>
    </DashboardLayout>
  );
};

export default CommunicationSettings;
