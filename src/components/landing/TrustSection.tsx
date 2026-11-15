import { ArrowRight, ClipboardCheck, Database, Headphones, Scale } from "lucide-react";
import { Link } from "react-router-dom";

const items = [
  { icon: ClipboardCheck, title: "Access is scoped", desc: "Owners can give staff specific roles. Server-side checks enforce access to business and branch records." },
  { icon: Database, title: "Clear about data", desc: "Learn what the app verifies today and what still depends on hosting and operations." },
  { icon: Scale, title: "Straightforward plans", desc: "See regional prices, included features, promotion terms, and checkout availability before choosing." },
  { icon: Headphones, title: "Support is reachable", desc: "Contact Verifin by email or WhatsApp for product, privacy, or security questions." },
];

const TrustSection = () => (
  <section className="bg-muted/30 py-16" id="trust">
    <div className="container">
      <div className="mb-10 max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Trust and transparency</p>
        <h2 className="mt-3 mb-3 font-display text-2xl font-bold sm:text-3xl">
          Know how Verifin works before you trust it with your records
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">We explain the access controls in the app, the data you enter, and the operational safeguards that still need confirmation.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <article key={item.title} className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <item.icon className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mb-2 font-display text-sm font-semibold">{item.title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
          </article>
        ))}
      </div>
      <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
        <Link to="/security" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">Read the Security Center <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        <Link to="/privacy" className="text-primary underline-offset-4 hover:underline">Read the Privacy Policy</Link>
        <Link to="/contact" className="text-primary underline-offset-4 hover:underline">Contact support</Link>
      </div>
    </div>
  </section>
);

export default TrustSection;
