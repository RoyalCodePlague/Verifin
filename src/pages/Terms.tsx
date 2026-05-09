import { AlertTriangle, CreditCard, FileText, Gavel, Globe, Lock, Mail, RefreshCw, Scale, Shield } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const highlights = [
  "Use Verifin only for lawful business purposes.",
  "You are responsible for users, staff permissions, and data entered under your account.",
  "You own your business data; Verifin owns the platform, software, brand, and product design.",
  "Paid subscriptions renew until cancelled, unless your plan or written agreement says otherwise.",
];

const sections = [
  {
    icon: FileText,
    title: "1. Acceptance of Terms",
    content:
      'These Terms of Service ("Terms") govern your access to and use of Verifin, including our website, app, APIs, offline sync features, support, and related services. By creating an account, using the service, or allowing staff to use it, you agree to these Terms. If you use Verifin for a business, you confirm that you have authority to bind that business.',
  },
  {
    icon: Globe,
    title: "2. The Service",
    content:
      "Verifin is a business operating platform for SMEs. Features may include inventory, branches, suppliers, purchase orders, sales, tills, expenses, customers, loyalty and credit tools, audits, reports, staff permissions, notifications, offline sync, AI-assisted insights, billing, and API access. Features can vary by plan, region, release stage, and account configuration.",
  },
  {
    icon: Shield,
    title: "3. Accounts and Security",
    items: [
      "You must provide accurate account, business, and billing information.",
      "You are responsible for protecting passwords, devices, API keys, and staff access.",
      "You are responsible for all activity under your account, including staff actions.",
      "You must notify us promptly if you suspect unauthorized access or misuse.",
      "We may require verification, reset credentials, or restrict access where needed to protect the service.",
    ],
  },
  {
    icon: CreditCard,
    title: "4. Plans, Trials, Billing, and Cancellation",
    items: [
      "Some features are free; others require a paid plan or trial.",
      "Trial access may be limited, changed, or ended if abused or if you are not eligible.",
      "Subscription fees, included features, limits, taxes, and billing cycles are shown during checkout or in the app.",
      "Paid subscriptions renew automatically unless cancelled before the renewal date.",
      "You can cancel a subscription, but cancellation usually takes effect at the end of the current billing period.",
      "We may change prices or plan features with reasonable notice where required.",
      "Refunds are provided only where required by law, stated in the app, or approved by Verifin in writing.",
    ],
  },
  {
    icon: Lock,
    title: "5. Your Data and Privacy",
    content:
      "You retain ownership of business data you submit to Verifin. You grant us permission to host, process, transmit, back up, analyze, and display that data as needed to provide, secure, support, and improve the service. Our Privacy Policy explains how personal information is handled.",
  },
  {
    icon: AlertTriangle,
    title: "6. Acceptable Use",
    content: "You agree that you will not:",
    items: [
      "Use Verifin for unlawful, fraudulent, harmful, or misleading activity.",
      "Attempt to access accounts, records, systems, or APIs without authorization.",
      "Bypass security, usage limits, billing controls, or staff permission controls.",
      "Upload malicious code or interfere with the reliability of the service.",
      "Scrape, copy, resell, sublicense, or redistribute Verifin without written permission.",
      "Reverse engineer the platform except where applicable law expressly allows it.",
      "Use AI-assisted features to generate unlawful, discriminatory, or harmful outputs.",
    ],
  },
  {
    icon: Shield,
    title: "7. AI-Assisted Features",
    content:
      "Verifin may provide AI-assisted summaries, forecasts, reorder suggestions, receipt extraction, or business insights. These outputs are informational and may be incomplete or inaccurate. You are responsible for reviewing outputs before relying on them for stock, pricing, tax, accounting, staffing, legal, or financial decisions.",
  },
  {
    icon: Globe,
    title: "8. Offline Mode and Sync",
    content:
      "Offline features are designed to help you continue recording selected activity when connectivity is limited. You are responsible for syncing regularly, resolving conflicts, and checking that records are accurate after sync. We are not responsible for loss caused by device failure, deleted local storage, extended offline use, or unsynced records outside our control.",
  },
  {
    icon: FileText,
    title: "9. APIs and Integrations",
    content:
      "API access and integrations may be available only on selected plans. You must keep API keys confidential and comply with rate limits, documentation, and security requirements. We may suspend API access that harms the service, risks data exposure, or breaches these Terms.",
  },
  {
    icon: Scale,
    title: "10. Intellectual Property",
    content:
      "Verifin and its licensors own the platform, software, source code, design, workflows, documentation, brand, logos, and other service materials. These Terms do not transfer ownership of Verifin intellectual property to you. You may use Verifin only as allowed by these Terms and your plan.",
  },
  {
    icon: RefreshCw,
    title: "11. Changes to the Service",
    content:
      "We may add, remove, suspend, rename, or change features to improve Verifin, comply with law, protect users, or adjust plans. We will try to provide reasonable notice for material changes that negatively affect paid users.",
  },
  {
    icon: AlertTriangle,
    title: "12. Suspension and Termination",
    content:
      "We may suspend or terminate access if you breach these Terms, fail to pay fees, create risk for other users, misuse the service, or if required by law. You may stop using Verifin at any time. After termination, your right to use the service ends, but provisions that by nature should survive will continue.",
  },
  {
    icon: Scale,
    title: "13. Disclaimers",
    content:
      'Verifin is provided on an "as is" and "as available" basis to the maximum extent permitted by law. We do not guarantee that the service will be uninterrupted, error-free, or suitable for every business need. You are responsible for verifying records, exports, reports, AI outputs, tax calculations, and operational decisions.',
  },
  {
    icon: Shield,
    title: "14. Limitation of Liability",
    content:
      "To the maximum extent permitted by law, Verifin will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost revenue, loss of goodwill, business interruption, or data loss. Where liability cannot be excluded, it is limited to the amount you paid to Verifin for the service in the three months before the event giving rise to the claim, unless applicable law requires otherwise.",
  },
  {
    icon: Gavel,
    title: "15. Indemnity",
    content:
      "You agree to defend, indemnify, and hold Verifin harmless from claims, losses, liabilities, damages, costs, and expenses arising from your data, your use of the service, staff actions, breach of these Terms, or violation of law or third-party rights.",
  },
  {
    icon: Gavel,
    title: "16. Disputes and Governing Law",
    content:
      "These Terms are governed by the laws of the Republic of South Africa, unless mandatory local law says otherwise. The parties will first try to resolve disputes in good faith. If unresolved, disputes may be brought before courts with jurisdiction in South Africa, subject to applicable law.",
  },
  {
    icon: FileText,
    title: "17. Changes to These Terms",
    content:
      "We may update these Terms from time to time. If changes are material, we will take reasonable steps to notify you by email, in-app notice, or another appropriate method. Continued use of Verifin after the effective date means you accept the updated Terms.",
  },
  {
    icon: Mail,
    title: "18. Contact",
    content: "For questions about these Terms, contact us at robzmtambo@gmail.com or visit the Contact page.",
  },
];

const Terms = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <main>
      <section className="border-b border-border bg-gradient-to-b from-accent/15 to-background px-4 py-16">
        <div className="container max-w-4xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-accent/30 bg-background/80 px-3 py-1 text-sm font-medium text-accent">
            <FileText className="h-4 w-4" />
            Terms of Service
          </div>
          <h1 className="max-w-3xl text-4xl font-bold tracking-normal sm:text-5xl">The rules for using Verifin</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            These terms explain account responsibilities, subscriptions, acceptable use, data ownership, and service limitations.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">Last updated: May 9, 2026</p>
        </div>
      </section>

      <section className="px-4 py-12">
        <div className="container grid max-w-5xl gap-8 lg:grid-cols-[280px_1fr]">
          <aside className="lg:sticky lg:top-24 lg:h-fit">
            <Card className="shadow-soft">
              <CardContent className="p-5">
                <h2 className="mb-3 text-base font-semibold">Key points</h2>
                <ul className="space-y-3">
                  {highlights.map((item) => (
                    <li key={item} className="flex gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
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

export default Terms;
