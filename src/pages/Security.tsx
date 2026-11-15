import { AlertTriangle, CheckCircle2, Database, KeyRound, LockKeyhole, Mail, Shield, Users } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const verifiedControls = [
  {
    icon: KeyRound,
    title: "Sign-in and account protection",
    body: "Email-and-password registrations must verify their email before they can sign in. Passwords are stored using Django's password-hashing system, and repeated authentication attempts are rate-limited.",
  },
  {
    icon: LockKeyhole,
    title: "Session controls",
    body: "API access tokens expire after 30 minutes. Refresh tokens expire after 7 days and rotate when renewed; previously used refresh tokens are blacklisted.",
  },
  {
    icon: Users,
    title: "Business and staff access",
    body: "The server checks account, staff, role, and branch permissions for protected operations. A signed-in user cannot grant themselves staff access through the public API.",
  },
  {
    icon: Database,
    title: "Business records",
    body: "Protected business records are queried within the signed-in account's scope. Staff access is limited by the permissions and branch rules enforced by the server.",
  },
];

const needsWork = [
  "Browser access and refresh tokens are currently stored in local storage. Moving them to a server-managed, HttpOnly cookie session would reduce exposure to script-based token theft and requires an application authentication change.",
  "The codebase does not verify the live database or file-storage encryption-at-rest configuration, hosting access controls, or the security of the production network edge. These depend on the deployed infrastructure.",
  "A backup and recovery schedule, restore-test evidence, and recovery targets are not documented in the codebase. We cannot state that a particular backup cadence or recovery time is in place.",
  "There is no self-service account deletion flow or published account-record retention schedule. Contact support to request help with an account or data request; the handling process and timing need to be formalized.",
];

const Security = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <main>
      <section className="border-b border-border bg-gradient-to-b from-primary/10 to-background px-4 py-16">
        <div className="container max-w-4xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-primary/20 bg-background/80 px-3 py-1 text-sm font-medium text-primary">
            <Shield className="h-4 w-4" /> Security Center
          </div>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">How Verifin approaches account and data protection</h1>
          <p className="mt-5 max-w-3xl text-lg text-muted-foreground">
            This page describes controls verified in the application code and calls out areas that still need infrastructure confirmation or product work. It is not a security certification or an independent audit.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold">Controls in the application</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">The controls below were confirmed in Verifin's current backend configuration and request handling. Deployed hosting settings can add or change protections and have not been independently inspected here.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {verifiedControls.map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-lg border border-border bg-card p-5 shadow-soft">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
                <div><h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p></div>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-8 rounded-lg border border-amber-300/70 bg-amber-50/70 p-5 dark:border-amber-700/50 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-amber-700 dark:text-amber-400" />
            <div><h2 className="font-semibold">Production transport settings</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">When Django runs with debug mode disabled, its configuration enables secure session and CSRF cookies, HSTS, and browser security headers. This confirms the application configuration only; it does not confirm the settings or TLS behavior of the live hosting environment.</p></div>
          </div>
        </div>

        <div className="mt-10">
          <div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-400" /><h2 className="text-2xl font-bold">Work and operational details still to confirm</h2></div>
          <ul className="mt-5 space-y-3">
            {needsWork.map((item) => <li key={item} className="rounded-lg border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">{item}</li>)}
          </ul>
        </div>

        <div className="mt-10 rounded-lg border border-border bg-muted/40 p-6">
          <h2 className="text-xl font-bold">Report a security concern</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">If you believe an account or business record may be exposed, contact the Verifin team with the details needed to investigate. Do not include passwords, one-time codes, or payment credentials in your message.</p>
          <a href="mailto:verifin2026@gmail.com?subject=Verifin%20security%20concern" className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Mail className="h-4 w-4" /> Email the support team</a>
        </div>
      </section>
    </main>
    <Footer />
  </div>
);

export default Security;
