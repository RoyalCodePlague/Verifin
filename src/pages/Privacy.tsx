import { Cookie, Database, Eye, FileText, Globe, Lock, Mail, Shield, UserCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const summary = [
  "We use your data to run Verifin, secure accounts, sync records, provide support, and improve the product.",
  "You own the business data you add to Verifin, including inventory, sales, expenses, customers, audits, and staff records.",
  "We do not sell your personal or business data.",
  "You can contact support about access, correction, export, or deletion requests. There is no self-service account deletion flow or published handling timeline yet.",
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
        items: ["Email address and password for email registration, plus optional business name and account or billing settings.", "Staff account details, roles, permissions, and activity logs if you invite staff users."],
      },
      {
        subtitle: "Business data you enter",
        items: ["Inventory, products, suppliers, stock movements, purchase orders, branches, sales, expenses, customers, loyalty and credit records, audits, reports, invoices, and settings.", "Files or images you upload, such as receipts or product-related images."],
      },
      {
        subtitle: "Usage and technical data",
        items: ["Technical and operational data generated when you use the service, such as request logs and device or browser details, where collected by the application or its hosting providers.", "The website loads Google Analytics only after you choose Allow analytics in the consent notice. You can change your choice using Privacy settings in the footer. Google may process website usage information under its own privacy terms.", "If you opt in through Settings, first-party product milestones such as first product creation, sale recording, and expense recording are stored by Verifin. These events use a random pseudonymous identifier and do not include the business record itself. A backend command exists to purge events older than 365 days, but the production schedule for that command has not been verified. Turning off this product analytics consent deletes events currently associated with that identifier.", "Offline queue and sync metadata needed to keep your records consistent across sessions."],
      },
      {
        subtitle: "Billing data",
        items: ["Plan, subscription status, payment status, and payment provider references. The current Paynow flow redirects to or initiates checkout with Paynow; Verifin records the payment reference and status and does not request card details in its own checkout form."],
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
      "Generate business insights or suggestions where you choose to use those features.",
      "Comply with legal, tax, accounting, fraud prevention, and regulatory obligations.",
    ],
  },
  {
    icon: Globe,
    title: "4. When We Share Information",
    content: "We do not sell your data. We only share information where needed to provide the service, comply with law, or protect Verifin and its users.",
    items: [
      "Service providers that help with hosting, database infrastructure, email delivery, support, and security. If you allow website analytics, Google Analytics receives website usage information; Verifin's current site code no longer loads the separate Tag Manager container.",
      "Your authorized staff users, based on the permissions you configure.",
      "Law enforcement, regulators, courts, or other parties where legally required or necessary to protect rights, safety, and security.",
      "A successor organization if Verifin is involved in a merger, acquisition, restructuring, financing, or sale of assets, subject to appropriate confidentiality safeguards.",
    ],
  },
  {
    icon: Lock,
    title: "5. Security",
    content:
      "Verifin requires email verification before email-and-password sign-in, protects stored passwords, limits repeated authentication attempts, expires and rotates API tokens, and checks account and staff permissions on protected requests. Browser tokens are currently stored in local storage. The deployed database, file-storage encryption, production network edge, and hosting access configuration have not been independently verified.",
    items: [
      "Production application settings are configured to enable secure session and request-protection cookies, strict transport security, and browser security headers. This describes application configuration; the live deployment has not been checked.",
      "Server-side checks scope protected business records and staff actions to the relevant account, role, and branch permissions.",
      "The codebase does not establish a database or file encryption-at-rest configuration, backup schedule, restore-test record, or recovery target. These operational controls need confirmation from the hosting environment.",
    ],
  },
  {
    icon: FileText,
    title: "6. Data Retention",
    content:
      "A complete retention schedule for account and business records is not currently published. A backend command can delete opted-in pseudonymous product events older than 365 days, but its production schedule has not been confirmed. Turning off analytics consent deletes the events associated with that identifier. Verifin does not currently provide a self-service account deletion flow or a published deletion timeline. Contact support about an account or data request and export available business reports before you lose access to a paid feature.",
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
      "Request an export of business information where technically available. Some report exports are available in the app.",
      "Request deletion or correction by contacting support. Requests are handled subject to applicable law and records that must be retained; there is no published processing timeline yet.",
      "Complain to the Information Regulator or another competent authority.",
    ],
  },
  {
    icon: Cookie,
    title: "8. Cookies and Similar Technologies",
    content:
      "Essential browser storage supports authentication, preferences, offline workflows, and session continuity. Website analytics remains off until you choose Allow analytics. Use Privacy settings in the footer to change that choice; choosing Essential only stops future analytics measurement, removes the script from the current page and clears accessible Google Analytics cookies. If you previously allowed analytics, the script may already have loaded for that page view; the saved Essential only choice prevents it loading on later visits. The separate product-milestone setting is in account Settings. Disabling essential cookies or local storage may affect login, offline mode, and app functionality.",
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
      "For privacy questions, data requests, or concerns, contact us at verifin2026@gmail.com. You may also contact South Africa's Information Regulator at enquiries@inforegulator.org.za.",
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
          <p className="mt-4 text-sm text-muted-foreground">Last updated: September 25, 2026</p>
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
