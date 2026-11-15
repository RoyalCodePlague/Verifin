import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Check, HelpCircle, MessageCircle } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import { useAuth } from "@/lib/auth-context";
import { getDetectedPricingCountry, getPricingContextApi, type BillingPeriod, type PlanCode, type RegionalPlanPrice } from "@/lib/api";
import { fallbackPricingContextForCountry } from "@/lib/pricing";

const features: Record<PlanCode, string[]> = {
  starter: ["1 user", "Up to 50 products", "Up to 100 customers", "Basic sales and expenses", "Daily summaries and simple reports"],
  growth: ["Up to 3 users", "Unlimited products and customers", "Inventory audits and low-stock alerts", "Advanced reports and insights", "Customer credit, QR loyalty and receipt tools"],
  business: ["Unlimited users", "Everything in Growth", "Staff roles and branch controls", "Custom reports and Excel exports", "API access and automation tools"],
};

const comparison = [
  ["Users", "1", "Up to 3", "Unlimited"],
  ["Products", "Up to 50", "Unlimited", "Unlimited"],
  ["Customers", "Up to 100", "Unlimited", "Unlimited"],
  ["Sales and basic expenses", "Included", "Included", "Included"],
  ["Advanced reports and insights", "—", "Included", "Included"],
  ["Staff roles and branch controls", "—", "—", "Included"],
];

const faqs = [
  ["Are prices converted using a daily exchange rate?", "No. These are preset regional prices, not live currency conversions. For Zimbabwe, paid plans are listed and charged in USD. A local-currency equivalent is not automatically calculated at checkout."],
  ["What payment methods are available?", "Paynow checkout is shown only when it is enabled and configured, and the current checkout supports paid USD plans. The hosted checkout displays the methods available to you; eligible mobile checkout options in the app include EcoCash and OneMoney. Other regional currencies are listed for price reference, but payment support is not yet available for them."],
  ["Is the 30-day Business promotion a paid trial?", "When the launch promotion is enabled, a new account receives Business access for 30 days. No payment details are collected for the promotion. When it ends, the account returns to the free Starter plan without a charge."],
  ["Will a paid plan renew automatically?", "No automatic renewal is set up. A payment is a one-time checkout for the selected 30-day or 365-day period. If paid access reaches its end date, there is a 7-day grace period; after that, paid features stop. Your records are not automatically deleted because a plan expires."],
  ["How do I cancel?", "Because paid plans do not auto-renew, there is no recurring payment to cancel. Paid access ends at the end of the period if it is not renewed. For questions about an existing payment or account, contact support."],
  ["What happens at a plan limit?", "The app blocks a limited action and explains which plan supports it. Starter limits one user, 50 products and 100 customers; Growth allows up to 3 users and unlimited products and customers; Business has unlimited users."],
];

const tone: Record<PlanCode, string> = {
  starter: "border-border bg-card dark:bg-card",
  growth: "border-emerald-300 bg-emerald-50/70 dark:border-emerald-700/60 dark:bg-emerald-950/30",
  business: "border-sky-300 bg-sky-50/70 dark:border-sky-700/60 dark:bg-sky-950/30",
};

function priceFor(price: RegionalPlanPrice, period: BillingPeriod) {
  const amount = Number(period === "yearly" ? price.yearly_price : price.monthly_price);
  if (amount <= 0) return "Free";
  return `${price.currency_symbol}${amount.toLocaleString("en-ZA")} ${price.currency}`;
}

const Pricing = () => {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [country, setCountry] = useState(() => getDetectedPricingCountry());
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { data } = useQuery({ queryKey: ["pricing-context", country], queryFn: () => getPricingContextApi(country) });
  const fallbackPricingContext = fallbackPricingContextForCountry(country);
  const pricing = data ?? fallbackPricingContext;
  const prices = (pricing.prices.length ? pricing.prices : fallbackPricingContext.prices).sort((a, b) => a.plan.sort_order - b.plan.sort_order);

  const startPlan = (planCode: PlanCode = "starter") => {
    const billingPath = `/billing?country=${encodeURIComponent(country)}&period=${period}&plan=${planCode}`;
    navigate(isAuthenticated ? billingPath : "/login?signup=1");
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <section className="border-b border-border bg-muted/30 dark:bg-muted/10">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">Pricing</p>
              <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Start free. Upgrade when your shop is ready.</h1>
              <p className="mt-5 text-lg text-muted-foreground">Compare what is included, the limits that apply and the payment options currently supported.</p>
            </div>
            <div className="mt-8 inline-flex rounded-md border border-border bg-background/90 p-1 dark:bg-card" role="group" aria-label="Billing period">
              {(["monthly", "yearly"] as BillingPeriod[]).map((next) => (
                <button key={next} type="button" aria-pressed={period === next} onClick={() => setPeriod(next)} className={`rounded px-5 py-2 text-sm font-bold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${period === next ? "bg-foreground text-background dark:bg-primary dark:text-primary-foreground" : "text-muted-foreground hover:text-foreground dark:hover:bg-muted/30"}`}>
                  {next}
                </button>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">Preset prices for {pricing.country_name} ({pricing.currency})</span>
              <label className="sr-only" htmlFor="pricing-country">Change pricing country</label>
              <select id="pricing-country" value={country || pricing.country_code} onChange={(event) => setCountry(event.target.value)} className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground dark:bg-card">
                {pricing.available_countries.map((option) => <option key={option.country_code} value={option.country_code}>{option.country_name} ({option.currency})</option>)}
              </select>
              <span className="text-xs text-muted-foreground">Regional prices are set in advance; no daily exchange rate is applied.</span>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8" aria-label="Available plans">
          <div className="grid gap-5 lg:grid-cols-3">
            {prices.map((price) => {
              const plan = price.plan;
              return (
                <article key={plan.code} className={`relative rounded-lg border p-6 shadow-soft ${tone[plan.code]}`}>
                  {plan.code === "growth" && <span className="absolute right-4 top-4 rounded-md bg-emerald-600 px-3 py-1 text-xs font-bold text-white">Most Popular</span>}
                  <h2 className="text-2xl font-bold">{plan.name}</h2>
                  <p className="mt-2 min-h-12 text-sm text-muted-foreground">{plan.description}</p>
                  <div className="mt-6 flex flex-wrap items-end gap-1">
                    <span className="text-4xl font-bold">{priceFor(price, period)}</span>
                    {Number(period === "yearly" ? price.yearly_price : price.monthly_price) > 0 && <span className="pb-1 text-sm text-muted-foreground">/{period === "yearly" ? "year" : "month"}</span>}
                  </div>
                  {period === "yearly" && plan.code !== "starter" && <p className="mt-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">Yearly price equals 10 monthly payments</p>}
                  <button type="button" onClick={() => startPlan(plan.code)} className="mt-6 w-full rounded-md bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                    {plan.code === "starter" ? "Start free" : isAuthenticated ? "Review in Billing" : "Create account to choose"}
                  </button>
                  <ul className="mt-6 space-y-3 text-sm">
                    {features[plan.code].map((feature) => <li key={feature} className="flex gap-2"><Check aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none text-emerald-600" /><span>{feature}</span></li>)}
                  </ul>
                </article>
              );
            })}
          </div>
          <div className="mt-6 rounded-lg border border-amber-300/70 bg-amber-50/70 p-5 text-sm leading-6 text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-100">
            <strong>Payment availability:</strong> Prices are preset by region, not recalculated using a live exchange rate. Paynow checkout must be enabled and configured and currently accepts paid USD plans only. In Zimbabwe, plans are priced in USD; a ZiG equivalent is not automatically calculated. Billing shows checkout availability before you pay. No card details are collected to start the free plan or launch promotion.
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold">Compare plans</h2>
          <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-background dark:bg-card">
            <table className="w-full min-w-[680px] text-left text-sm">
              <caption className="sr-only">Feature comparison for Starter, Growth and Business plans</caption>
              <thead className="bg-muted/70 dark:bg-muted/30"><tr><th scope="col" className="p-4">Feature</th><th scope="col" className="p-4">Starter</th><th scope="col" className="p-4">Growth</th><th scope="col" className="p-4">Business</th></tr></thead>
              <tbody>{comparison.map((row) => <tr key={row[0]} className="border-t border-border">{row.map((cell, index) => index === 0 ? <th scope="row" key={`${row[0]}-${index}`} className="p-4 font-medium">{cell}</th> : <td key={`${row[0]}-${index}`} className="p-4">{cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="bg-emerald-50/70 dark:bg-emerald-950/20">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
            <div><p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">Billing details</p><h2 className="mt-3 text-3xl font-bold">Know what happens after signup</h2></div>
            <div className="grid gap-4">{faqs.map(([q, a]) => <div key={q} className="rounded-lg border border-border bg-background p-5 dark:bg-card"><div className="flex gap-3"><HelpCircle aria-hidden="true" className="mt-0.5 h-5 w-5 flex-none text-emerald-700 dark:text-emerald-400" /><div><h3 className="font-bold">{q}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{a}</p></div></div></div>)}</div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-5 rounded-lg border border-border bg-primary/5 p-6 sm:flex-row sm:items-center sm:p-8">
            <div><h2 className="text-xl font-bold">Need help choosing or paying?</h2><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Ask the team about plans, payment availability or an existing payment.</p></div>
            <a href="https://wa.me/263775252409" target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><MessageCircle className="h-4 w-4" /> Ask on WhatsApp</a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Pricing;
