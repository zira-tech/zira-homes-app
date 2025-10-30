import { TestSMSButton } from "@/components/admin/TestSMSButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MessageSquare, CheckCircle2 } from "lucide-react";

export default function TestSMS() {
  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <MessageSquare className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-3xl">SMS Testing</CardTitle>
          <CardDescription>
            Send a test SMS to 254722241745 to verify the SMS system is working
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              This will send a test message to <strong>254722241745</strong> using the configured SMS provider.
              The message will be logged in the SMS Logs for tracking.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <h3 className="font-semibold mb-2">Test Message Content:</h3>
              <p className="text-sm text-muted-foreground">
                "🧪 Test SMS from ZIRA Property Management System<br/>
                <br/>
                This is a test message sent at [current time].<br/>
                <br/>
                If you received this message, the SMS system is working correctly! ✅<br/>
                <br/>
                - ZIRA Tech Team"
              </p>
            </div>

            <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                What happens when you click the button:
              </h3>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
                <li>Phone number is formatted to E.164 format (254...)</li>
                <li>Message is sent via the configured SMS provider</li>
                <li>Full details are logged in the SMS Logs table</li>
                <li>You'll receive a success or error notification</li>
              </ul>
            </div>

            <TestSMSButton />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
