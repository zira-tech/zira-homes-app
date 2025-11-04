import {
  Home,
  Building2,
  Users,
  FileText,
  CreditCard,
  Wrench,
  BarChart3,
  Settings,
  HelpCircle,
  Shield,
  MessageSquare,
  Monitor,
  UserCheck,
  PieChart,
  Mail,
  Package,
  DollarSign,
  Zap,
  Building,
  Receipt,
  ClipboardList,
  Bell,
  Database,
  TrendingUp,
  Phone,
  Server,
  Users2,
  Calendar,
  FileSpreadsheet,
  Banknote,
  Activity,
  Globe,
  Smartphone,
  Lock,
  BookOpen,
  MessageCircle,
  Headphones,
  LifeBuoy,
  Archive,
  FileBarChart,
  CircleDollarSign,
  UserCog,
} from "lucide-react";

export interface NavItem {
  title: string;
  url: string;
  icon: any;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

// Admin Navigation - Complete admin routes
export const adminNav: NavGroup[] = [
  {
    title: "Administration",
    items: [
      { title: "Admin Dashboard", url: "/admin", icon: Monitor },
      { title: "User Management", url: "/admin/users", icon: UserCheck },
      { title: "Landlord Management", url: "/admin/landlords", icon: Users2 },
      { title: "Platform Analytics", url: "/admin/analytics", icon: PieChart },
      { title: "Support Center", url: "/admin/enhanced-support", icon: Shield },
      { title: "Communication", url: "/admin/communication", icon: MessageSquare },
      { title: "System Config", url: "/admin/system", icon: Settings },
      { title: "Billing Dashboard", url: "/admin/billing", icon: CircleDollarSign },
      { title: "Trial Management", url: "/admin/trials", icon: Calendar },
      { title: "Email Templates", url: "/admin/email-templates", icon: Mail },
      { title: "Message Templates", url: "/admin/message-templates", icon: MessageCircle },
      { title: "PDF Templates", url: "/admin/pdf-templates", icon: FileText },
      { title: "Payment Config", url: "/admin/payment-config", icon: Banknote },
      { title: "Bulk Messaging", url: "/admin/bulk-messaging", icon: Smartphone },
      { title: "SMS Logs", url: "/admin/sms-logs", icon: MessageSquare },
      { title: "Audit Logs", url: "/admin/audit-logs", icon: Archive },
      { title: "Self-Hosted Monitor", url: "/admin/self-hosted", icon: Server },
      { title: "Invoice Management", url: "/admin/invoices", icon: Receipt },
    ],
  },
];

// Landlord/Manager/Agent Navigation - Complete landlord routes
export const landlordNav: NavGroup[] = [
  {
    title: "Main",
    items: [
      { title: "Dashboard", url: "/", icon: Home },
      { title: "Properties", url: "/properties", icon: Building2 },
      { title: "Units", url: "/units", icon: Building },
      { title: "Tenants", url: "/tenants", icon: Users },
      { title: "Leases", url: "/leases", icon: FileText },
      { title: "Maintenance", url: "/maintenance", icon: Wrench },
      { title: "Expenses", url: "/expenses", icon: Receipt },
      { title: "Invoices", url: "/invoices", icon: FileSpreadsheet },
      { title: "Payments", url: "/payments", icon: DollarSign },
      { title: "Reports", url: "/reports", icon: BarChart3 },
    ],
  },
  {
    title: "Management",
    items: [
      { title: "Billing Panel", url: "/billing", icon: CreditCard },
      { title: "Payment Settings", url: "/payment-settings", icon: Banknote },
      { title: "Sub Users", url: "/sub-users", icon: Users2 },
      { title: "Email Templates", url: "/billing/email-templates", icon: Mail },
      { title: "Message Templates", url: "/billing/message-templates", icon: MessageCircle },
      { title: "Notifications", url: "/notifications", icon: Bell },
    ],
  },
];

// Tenant Navigation - Keep existing tenant routes
export const tenantNav: NavGroup[] = [
  {
    title: "Main",
    items: [
      { title: "Dashboard", url: "/tenant", icon: Home },
      { title: "Maintenance", url: "/tenant/maintenance", icon: Wrench },
      { title: "Payments", url: "/tenant/payments", icon: CreditCard },
      { title: "Messages", url: "/tenant/messages", icon: MessageSquare },
      { title: "Support", url: "/tenant/support", icon: LifeBuoy },
    ],
  },
];

// Account items for all roles
export const accountNav: NavGroup = {
  title: "Account",
  items: [
    { title: "Settings", url: "/settings", icon: Settings },
    { title: "Help Center", url: "/knowledge-base", icon: HelpCircle },
    { title: "Support", url: "/support", icon: Headphones },
    { title: "Upgrade", url: "/upgrade", icon: Zap },
  ],
};
