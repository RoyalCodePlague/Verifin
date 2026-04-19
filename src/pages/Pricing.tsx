import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { BarChart3, Check, HelpCircle, Lock, ScanBarcode, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import { useAuth } from "@/lib/auth-context";
import { listBillingPlansApi, type BillingPeriod, type BillingPlan, type PlanCode } from "@/lib/api";

const fallbackPlans: BillingPlan[] = [
  {
    id: 1,
    code: "starter",
    name: "Starter",
    description: "Free forever for solo owners getting started.",
    monthly_price: "0.00",
    yearly_price: "0.00",
    currency: "ZAR",
    sort_order: 1,
    limits: [],
  },
  {
    id: 2,
    code: "growth",
    name: "Growth",
    description: "For growing SMEs that need automation and unlimited stock.",
    monthly_price: "299.00",
    yearly_price: "2990.00",
    currency: "ZAR",
    sort_order: 2,
    limits: [],
  },
  {
    id: 3,
    code: "business",
    name: "Business",
    description: "For established businesses needing advanced control.",
    monthly_price: "599.00",
    yearly_price: "5990.00",
    currency: "ZAR",
    sort_order: 3,
    limits: [],
  },
];

const features: Record<PlanCode, string[]> = {
  starter: ["1 user", "50 products", "100 customers", "Basic sales", "Daily summaries", "2 basic reports"],
  growth: ["3 users", "Unlimited products", "AI admin assistant", "Audits and barcode scanning", "Receipt OCR", "8 reports with charts"],
  business: ["Unlimited users", "Forecasting", "Advanced analytics", "Role-based access", "Offline auto-sync", "Excel exports and API access"],
};

const comparison = [
  ["Users", "1", "3", "Unlimited"],
  ["Products", "50", "Unlimited", "Unlimited"],
  ["Customers", "100", "Unlimited", "Unlimited"],
  ["AI assistance", "Locked", "Included", "Included"],
  ["Forecasting", "Locked", "Locked", "Included"],
  ["Exports", "Basic", "Reports", "Excel and API"],
];

const faqs = [
  ["Do I need a card today?", "No. The current checkout is a local mock flow for testing subscriptions before a real payment provider is connected."],
  ["Can I switch plans?", "Yes. Upgrades, downgrades, renewals, cancellations, trials, and grace periods are handled by the backend billing engine."],
  ["What happens at a limit?", "The app blocks the action, explains the limit, and points the user to the plan that unlocks it."],
  ["Can this move to real payments later?", "Yes. The backend already stores provider IDs, events, payments, billing cycles, and webhook-ready records."],
];

const trustItems: Array<[LucideIcon, string]> = [
  [ShieldCheck, "Mock billing, real rules"],
  [Lock, "Feature gates in the API"],
  [ScanBarcode, "Growth tools unlock cleanly"],
  [BarChart3, "Business analytics ready"],
];

const tone: Record<PlanCode, string> = {
  starter: "border-slate-200 bg-white",
  growth: "border-emerald-300 bg-emerald-50",
  business: "border-sky-300 bg-sky-50",
};

function priceFor(plan: BillingPlan, period: BillingPeriod) {
  const amount = Number(period === "yearly" ? plan.yearly_price : plan.monthly_price);
  if (amount <= 0) return "Free";
  return `R${amount.toLocaleString("en-ZA")}`;
}

const Pricing = () => {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { data } = useQuery({ queryKey: ["public-billing-plans"], queryFn: listBillingPlansApi });
  const plans = (data?.length ? data : fallbackPlans).sort((a, b) => a.sort_order - b.sort_order);

  const startPlan = () => {
    navigate(isAuthenticated ? "/billing" : "/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <section className="border-b bg-slate-50">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">Pricing</p>
              <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Start free. Upgrade when the business needs more power.</h1>
              <p className="mt-5 text-lg text-muted-foreground">
                Clear limits, test billing controls, and premium features that unlock only when the plan allows them.
              </p>
            </div>
            <div className="mt-8 inline-flex rounded-md border bg-white p-1">
              {(["monthly", "yearly"] as BillingPeriod[]).map((next) => (
                <button key={next} type="button" onClick={() => setPeriod(next)} className={`rounded px-5 py-2 text-sm font-bold capitalize ${period === next ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                  {next}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-5 lg:grid-cols-3">
            {plans.map((plan) => (
              <article key={plan.code} className={`relative rounded-lg border p-6 ${tone[plan.code]}`}>
                {plan.code === "growth" && <span className="absolute right-4 top-4 rounded-md bg-emerald-600 px-3 py-1 text-xs font-bold text-white">Most Popular</span>}
                <h2 className="text-2xl font-bold">{plan.name}</h2>
                <p className="mt-2 min-h-12 text-sm text-muted-foreground">{plan.description}</p>
                <div className="mt-6 flex items-end gap-1">
                  <span className="text-4xl font-bold">{priceFor(plan, period)}</span>
                  {Number(period === "yearly" ? plan.yearly_price : plan.monthly_price) > 0 && <span className="pb-1 text-sm text-muted-foreground">/{period === "yearly" ? "year" : "month"}</span>}
                </div>
                {period === "yearly" && plan.code !== "starter" && <p className="mt-2 text-sm font-semibold text-emerald-700">Two months included</p>}
                <button type="button" onClick={startPlan} className="mt-6 w-full rounded-md bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90">
                  {plan.code === "starter" ? "Start free" : "Test upgrade"}
                </button>
                <ul className="mt-6 space-y-3 text-sm">
                  {features[plan.code].map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y bg-white">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
            {trustItems.map(([Icon, label]) => (
              <div key={label} className="flex items-center gap-3 rounded-md border p-4">
                <Icon className="h-5 w-5 text-emerald-700" />
                <span className="text-sm font-semibold">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold">Compare Plans</h2>
          <div className="mt-6 overflow-hidden rounded-lg border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-4">Feature</th>
                  <th className="p-4">Starter</th>
                  <th className="p-4">Growth</th>
                  <th className="p-4">Business</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row[0]} className="border-t">
                    {row.map((cell) => (
                      <td key={cell} className="p-4">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-emerald-50">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">Questions</p>
              <h2 className="mt-3 text-3xl font-bold">Built for testing today and payments tomorrow.</h2>
            </div>
            <div className="grid gap-4">
              {faqs.map(([q, a]) => (
                <div key={q} className="rounded-lg border bg-white p-5">
                  <div className="flex gap-3">
                    <HelpCircle className="mt-0.5 h-5 w-5 flex-none text-emerald-700" />
                    <div>
                      <h3 className="font-bold">{q}</h3>
                      <p className="mt-2 text-sm text-muted-foreground">{a}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="rounded-lg border bg-slate-950 p-8 text-white">
            <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="flex items-center gap-2 text-sm font-bold text-emerald-300"><Sparkles className="h-4 w-4" /> Local billing sandbox</p>
                <h2 className="mt-3 text-3xl font-bold">Try the full subscription journey without touching real money.</h2>
                <p className="mt-3 max-w-2xl text-slate-300">Use the in-app Billing page to activate plans, renew, cancel, resume, and test limits.</p>
              </div>
              <button type="button" onClick={startPlan} className="rounded-md bg-white px-6 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-100">
                Open billing
              </button>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Pricing;
