import { Cookie, Database, Eye, FileText, Globe, Lock, Mail, Shield, UserCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const summary = [
  "We use your data to run Verifin, secure accounts, sync records, process subscriptions, and improve the product.",
  "You own the business data you add to Verifin, including inventory, sales, expenses, customers, audits, and staff records.",
  "We do not sell your personal or business data.",
  "You can ask to access, correct, export, or delete your personal information.",
];

const sections = [
  {
    icon: Shield,
    title: "1. Who We Are",
    content:
      'Verifin ("Verifin", "we", "our", or "us") provides inventory, sales, expense, reporting, audit, customer, staff, billing, and business automation tools for small and medium-sized businesses. This Privacy Policy explains how we collect, use, store, share, and protect information when you use our website, app, APIs, and related services.',
  },
  {
    icon: Database,
    title: "2. Information We Collect",
    subsections: [
      {
        subtitle: "Account and contact information",
        items: ["Name, email address, phone number, business name, country, currency, and login details.", "Staff account details, roles, permissions, and activity logs if you invite staff users."],
      },
      {
        subtitle: "Business data you enter",
        items: ["Inventory, products, suppliers, stock movements, purchase orders, branches, sales, expenses, customers, loyalty and credit records, audits, reports, invoices, and settings.", "Files or images you upload, such as receipts or product-related images."],
      },
      {
        subtitle: "Usage and technical data",
        items: ["Device, browser, IP address, approximate location, page views, feature usage, logs, crash reports, and security events.", "Offline queue and sync metadata needed to keep your records consistent across sessions."],
      },
      {
        subtitle: "Billing data",
        items: ["Plan, subscription status, invoices, payment status, and payment provider references. Card or payment instrument details are processed by payment providers and are not stored directly by Verifin unless clearly stated."],
      },
    ],
  },
  {
    icon: Eye,
    title: "3. How We Use Information",
    items: [
      "Provide, operate, secure, and maintain Verifin.",
      "Authenticate users, enforce roles and permissions, and prevent unauthorized access.",
      "Sync offline records, generate reports, track usage limits, and manage subscriptions.",
      "Provide support, respond to requests, and send product, billing, security, and service messages.",
      "Improve reliability, performance, onboarding, analytics, and product features.",
      "Generate AI-assisted insights or suggestions where you choose to use those features.",
      "Comply with legal, tax, accounting, fraud prevention, and regulatory obligations.",
    ],
  },
  {
    icon: Globe,
    title: "4. When We Share Information",
    content: "We do not sell your data. We only share information where needed to provide the service, comply with law, or protect Verifin and its users.",
    items: [
      "Service providers that help with hosting, database infrastructure, analytics, email, payments, support, logging, security, and AI-assisted features.",
      "Your authorized staff users, based on the permissions you configure.",
      "Law enforcement, regulators, courts, or other parties where legally required or necessary to protect rights, safety, and security.",
      "A successor organization if Verifin is involved in a merger, acquisition, restructuring, financing, or sale of assets, subject to appropriate confidentiality safeguards.",
    ],
  },
  {
    icon: Lock,
    title: "5. Security",
    content:
      "We use administrative, technical, and organizational safeguards designed to protect your information. No online service can guarantee perfect security, but we work to reduce risk and respond quickly to issues.",
    items: [
      "Authenticated access to protected areas.",
      "HTTPS for production connections.",
      "Role-based access controls for staff accounts.",
      "Soft-delete and audit patterns for selected business records.",
      "Ongoing improvements to backup, encryption, monitoring, and incident response controls.",
    ],
  },
  {
    icon: FileText,
    title: "6. Data Retention",
    content:
      "We keep information for as long as needed to provide Verifin, meet legal obligations, resolve disputes, prevent abuse, and enforce agreements. If you close your account, we will delete or anonymize account data within a reasonable period unless retention is required by law, security, backups, accounting, or legitimate business needs. You should export important records before deleting your account.",
  },
  {
    icon: UserCheck,
    title: "7. Your Rights",
    content:
      "Subject to applicable law, including South Africa's Protection of Personal Information Act (POPIA), you may have rights to:",
    items: [
      "Ask whether we hold personal information about you.",
      "Request access to your personal information.",
      "Request correction, destruction, or deletion of inaccurate, irrelevant, excessive, outdated, incomplete, misleading, or unlawfully obtained information.",
      "Object to certain processing on reasonable grounds.",
      "Object to direct marketing.",
      "Request export of your business data where technically available.",
      "Complain to the Information Regulator or another competent authority.",
    ],
  },
  {
    icon: Cookie,
    title: "8. Cookies and Similar Technologies",
    content:
      "We use essential storage and cookies for authentication, security, preferences, and session continuity. We may also use analytics tools to understand product usage and improve the service. You can control browser cookies through your browser settings, but disabling essential cookies may affect login and app functionality.",
  },
  {
    icon: Globe,
    title: "9. International Processing",
    content:
      "Verifin may use infrastructure and service providers located outside your country. Where information is transferred internationally, we use reasonable safeguards designed to protect it in line with applicable data protection requirements.",
  },
  {
    icon: Shield,
    title: "10. Children's Privacy",
    content:
      "Verifin is intended for business use and is not directed at children under 18. We do not knowingly collect personal information from children. If you believe a child has provided information to us, contact us so we can review and delete it where appropriate.",
  },
  {
    icon: FileText,
    title: "11. Changes to This Policy",
    content:
      "We may update this Privacy Policy from time to time. If changes are material, we will take reasonable steps to notify you by email, in-app notice, or another appropriate method. The updated policy applies from the date shown on this page.",
  },
  {
    icon: Mail,
    title: "12. Contact",
    content:
      "For privacy questions, data requests, or concerns, contact us at robzmtambo@gmail.com. You may also contact South Africa's Information Regulator at enquiries@inforegulator.org.za.",
  },
];

const Privacy = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <main>
      <section className="border-b border-border bg-gradient-to-b from-primary/10 to-background px-4 py-16">
        <div className="container max-w-4xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-primary/20 bg-background/80 px-3 py-1 text-sm font-medium text-primary">
            <Shield className="h-4 w-4" />
            Privacy Policy
          </div>
          <h1 className="max-w-3xl text-4xl font-bold tracking-normal sm:text-5xl">How Verifin handles your information</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            We keep the policy practical: what we collect, why we use it, who can access it, and the choices you have.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">Last updated: May 9, 2026</p>
        </div>
      </section>

      <section className="px-4 py-12">
        <div className="container grid max-w-5xl gap-8 lg:grid-cols-[280px_1fr]">
          <aside className="lg:sticky lg:top-24 lg:h-fit">
            <Card className="shadow-soft">
              <CardContent className="p-5">
                <h2 className="mb-3 text-base font-semibold">Plain-language summary</h2>
                <ul className="space-y-3">
                  {summary.map((item) => (
                    <li key={item} className="flex gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-4">
            {sections.map((section) => (
              <Card key={section.title} className="shadow-soft">
                <CardContent className="p-6">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-primary/10">
                      <section.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="mb-2 text-lg font-semibold">{section.title}</h2>
                      {"content" in section && section.content && <p className="text-sm leading-relaxed text-muted-foreground">{section.content}</p>}
                      {"subsections" in section &&
                        section.subsections?.map((subsection) => (
                          <div key={subsection.subtitle} className="mt-4">
                            <h3 className="mb-2 text-sm font-semibold">{subsection.subtitle}</h3>
                            <ul className="space-y-1.5">
                              {subsection.items.map((item) => (
                                <li key={item} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                                  <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/50" />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      {"items" in section && section.items && (
                        <ul className="mt-3 space-y-1.5">
                          {section.items.map((item) => (
                            <li key={item} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/50" />
                              <span>{item}</span>
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
    </main>
    <Footer />
  </div>
);

export default Privacy;
