import { FileText, Shield, CreditCard, Lock, Globe, Scale, AlertTriangle, RefreshCw, Gavel, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const sections = [
  { icon: FileText, title: "1. Acceptance of Terms", content: 'By accessing or using Verifin ("the Platform"), you agree to be bound by these Terms and Conditions. If you do not agree, you may not use the Platform.' },
  { icon: Globe, title: "2. Description of Service", content: "Verifin is a cloud-based business operating system designed for small and medium-sized enterprises (SMEs). The Platform provides inventory management, sales tracking, expense logging, audit tools, customer loyalty (QR-based), smart insights, reporting, and staff management features." },
  { icon: Shield, title: "3. Account Registration", content: "You must provide accurate, current, and complete information during registration. You are responsible for safeguarding your password and for all activities under your account. You must notify us immediately of any unauthorized use." },
  { icon: CreditCard, title: "4. Subscription & Billing", items: [
    "Starter Plan: Free forever with limited features (1 user, up to 50 products).",
    "Growth Plan (R299/month): Includes up to 3 users, unlimited products, admin assistance system, barcode scanning, WhatsApp reports, and priority support.",
    "Business Plan (R599/month): Unlimited users, advanced analytics, smart forecasting, custom reports, role-based access, offline mode, API access, and dedicated support.",
    "All paid plans include a 14-day free trial. You will not be charged during the trial period.",
    "You may cancel your subscription at any time. Cancellation takes effect at the end of the current billing period.",
    "Prices are in South African Rand (ZAR) and are subject to change with 30 days' notice.",
  ]},
  { icon: Lock, title: "5. Data Ownership & Privacy", content: 'You retain ownership of all business data entered into the Platform. We do not sell, rent, or share your data with third parties except as required to operate the service or comply with law. Data is encrypted in transit and at rest. For full details, see our Privacy Policy.' },
  { icon: AlertTriangle, title: "6. Acceptable Use", content: "You agree not to:", items: [
    "Use the Platform for any unlawful purpose or in violation of any applicable laws.",
    "Attempt to gain unauthorized access to the Platform or its related systems.",
    "Transmit any malicious code, viruses, or harmful content.",
    "Resell, sublicense, or redistribute the Platform without written consent.",
    "Use automated tools to scrape or extract data from the Platform.",
    "Impersonate another user or misrepresent your identity.",
  ]},
  { icon: Shield, title: "7. Intellectual Property", content: "All content, features, and functionality of Verifin — including but not limited to text, graphics, logos, icons, software, and design — are the exclusive property of Verifin and are protected by intellectual property laws." },
  { icon: Globe, title: "8. Service Availability & Offline Mode", content: "We strive for 99.9% uptime. The Platform includes offline-first functionality that allows recording sales and stock counts without internet. Data will automatically sync when connectivity is restored. We are not liable for data loss resulting from extended offline periods exceeding 30 days without sync." },
  { icon: FileText, title: "9. API Usage", content: "API access is available on the Business plan. API keys are confidential and must not be shared. We reserve the right to rate-limit or revoke API access for abusive usage." },
  { icon: Scale, title: "10. Limitation of Liability", content: "To the maximum extent permitted by law, Verifin shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or goodwill, arising out of or in connection with your use of the Platform." },
  { icon: Shield, title: "11. Indemnification", content: "You agree to indemnify and hold harmless Verifin, its officers, directors, employees, and agents from any claims, losses, damages, liabilities, and expenses arising from your use of the Platform or violation of these Terms." },
  { icon: AlertTriangle, title: "12. Termination", content: "We reserve the right to suspend or terminate your account if you violate these Terms. Upon termination, your right to use the Platform ceases immediately. You may request an export of your data within 30 days of termination." },
  { icon: RefreshCw, title: "13. Refund Policy", content: "We offer a full refund within 7 days of your first paid subscription. After 7 days, refunds are not available, but you may cancel your subscription at any time to prevent future charges." },
  { icon: Globe, title: "14. Force Majeure", content: "Verifin shall not be liable for any failure to perform due to events beyond its reasonable control, including natural disasters, power outages, internet disruptions, pandemics, or government actions." },
  { icon: Gavel, title: "15. Dispute Resolution", content: "In the event of a dispute, both parties agree to attempt resolution through good-faith negotiation. If negotiation fails, the dispute shall be submitted to mediation before pursuing legal action." },
  { icon: FileText, title: "16. Changes to Terms", content: "We may update these Terms from time to time. We will notify you of material changes via email or in-app notification. Continued use of the Platform after changes constitutes acceptance of the revised Terms." },
  { icon: Scale, title: "17. Governing Law", content: "These Terms are governed by the laws of the Republic of South Africa. Any disputes shall be resolved in the courts of Johannesburg, South Africa." },
  { icon: Mail, title: "18. Contact", content: "For questions about these Terms, contact us at legal@verifin.co.za or visit our Contact page." },
];

const Terms = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="py-16 px-4">
      <div className="container max-w-3xl">
        <div className="text-center mb-12">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <FileText className="h-7 w-7 text-primary" />
          </div>
          <h1 className="font-display font-bold text-3xl mb-2">Terms & Conditions</h1>
          <p className="text-muted-foreground">Last updated: April 5, 2026</p>
        </div>

        <div className="space-y-4">
          {sections.map((s) => (
            <Card key={s.title} className="shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <s.icon className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-display font-semibold text-lg mb-2">{s.title}</h2>
                    {s.content && <p className="text-sm text-muted-foreground leading-relaxed">{s.content}</p>}
                    {"items" in s && s.items && (
                      <ul className="space-y-1.5 mt-2">
                        {s.items.map((item) => (
                          <li key={item} className="text-sm text-muted-foreground flex items-start gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary/40 mt-1.5 flex-shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
    <Footer />
  </div>
);

export default Terms;
