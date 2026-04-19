import { Shield, Lock, Eye, Database, UserCheck, Globe, Cookie, FileText, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const sections = [
  { icon: Shield, title: "1. Introduction", content: 'Verifin ("we", "our", "us") is committed to protecting the privacy of our users. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform.' },
  { icon: Database, title: "2. Information We Collect", content: null, subsections: [
    { subtitle: "2.1 Personal Information", items: ["Name, email address, and phone number during registration", "Business name, industry, and location", "Payment information (processed securely via third-party providers)"] },
    { subtitle: "2.2 Business Data", items: ["Inventory records, sales transactions, and expense logs", "Customer information you enter into the platform", "Audit records and staff management data"] },
    { subtitle: "2.3 Automatically Collected Data", items: ["Device information (browser type, OS, screen resolution)", "Usage analytics (pages visited, features used, session duration)", "IP address and approximate location"] },
  ]},
  { icon: Eye, title: "3. How We Use Your Information", items: ["To provide and maintain the Verifin platform", "To generate AI-powered insights and recommendations", "To send notifications (low stock alerts, daily summaries)", "To improve our services and develop new features", "To process payments and manage subscriptions", "To communicate with you about updates and support"] },
  { icon: Globe, title: "4. Data Sharing", content: "We do not sell, rent, or trade your personal or business data. We may share data with:", items: ["Service providers: Hosting, payment processing, and analytics partners under strict confidentiality agreements", "Legal obligations: When required by law or to protect our legal rights", "Business transfers: In the event of a merger, acquisition, or asset sale"] },
  { icon: Lock, title: "5. Data Security", content: "We implement industry-standard security measures including:", items: ["AES-256 encryption for data at rest", "TLS 1.3 encryption for data in transit", "Regular security audits and penetration testing", "Role-based access controls and two-factor authentication", "Automated backups with 30-day retention"] },
  { icon: FileText, title: "6. Data Retention", content: "We retain your data for as long as your account is active. Upon account deletion, your data will be permanently removed within 30 days. You may request a data export at any time before deletion." },
  { icon: UserCheck, title: "7. Your Rights", content: "Under the Protection of Personal Information Act (POPIA) and applicable data protection laws, you have the right to:", items: ["Access your personal data", "Correct inaccurate information", "Request deletion of your data", "Object to processing of your data", "Data portability (export your data)", "Lodge a complaint with the Information Regulator"] },
  { icon: Cookie, title: "8. Cookies", content: "We use essential cookies for authentication and session management. Analytics cookies are used to improve our service. You can manage cookie preferences in your browser settings." },
  { icon: Shield, title: "9. Children's Privacy", content: "Verifin is not intended for use by individuals under 18 years of age. We do not knowingly collect data from minors." },
  { icon: FileText, title: "10. Changes to This Policy", content: "We may update this Privacy Policy periodically. We will notify you of material changes via email or in-app notification." },
  { icon: Mail, title: "11. Contact", content: "For privacy-related enquiries, contact us at robzmtambo@gmail.com." },
];

const Privacy = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="py-16 px-4">
      <div className="container max-w-3xl">
        <div className="text-center mb-12">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Shield className="h-7 w-7 text-primary" />
          </div>
          <h1 className="font-display font-bold text-3xl mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground">Last updated: April 5, 2026</p>
        </div>

        <div className="space-y-6">
          {sections.map((s) => (
            <Card key={s.title} className="shadow-soft">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <s.icon className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-display font-semibold text-lg mb-2">{s.title}</h2>
                    {s.content && <p className="text-sm text-muted-foreground leading-relaxed mb-2">{s.content}</p>}
                    {"subsections" in s && s.subsections?.map((sub) => (
                      <div key={sub.subtitle} className="mt-3">
                        <h3 className="font-display font-medium text-sm mb-1.5">{sub.subtitle}</h3>
                        <ul className="space-y-1">
                          {sub.items.map((item) => (
                            <li key={item} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary/40 mt-1.5 flex-shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {"items" in s && s.items && (
                      <ul className="space-y-1 mt-1">
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

export default Privacy;
