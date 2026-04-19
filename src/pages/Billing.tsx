import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Crown, Lock, RefreshCw, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  getBillingOverviewApi,
  listBillingPlansApi,
  mockCheckoutApi,
  subscriptionActionApi,
  type BillingPeriod,
  type BillingPlan,
  type FeatureLimit,
  type PlanCode,
} from "@/lib/api";

const planTone: Record<PlanCode, string> = {
  starter: "border-slate-200 bg-white",
  growth: "border-emerald-300 bg-emerald-50/70",
  business: "border-sky-300 bg-sky-50/70",
};

const formatMoney = (value: string, period: BillingPeriod) => {
  const amount = Number(value);
  if (amount <= 0) return "Free";
  return `R${amount.toLocaleString("en-ZA")}/${period === "yearly" ? "year" : "month"}`;
};

const formatDate = (value: string | null) => {
  if (!value) return "No renewal needed";
  return new Date(value).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
};

const visibleLimits = ["users", "products", "customers", "reports"];

function UsageRow({ limit }: { limit: FeatureLimit }) {
  const used = limit.used ?? 0;
  const max = limit.limit ?? Math.max(used, 1);
  const pct = limit.limit ? Math.min(100, Math.round((used / max) * 100)) : 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-foreground">{limit.label}</span>
        <span className="text-muted-foreground">{limit.limit == null ? `${used} used, unlimited` : `${used}/${limit.limit}`}</span>
      </div>
      <div className="h-2 rounded bg-muted overflow-hidden">
        <div className={`h-full rounded ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const CheckoutModal = ({
  plan,
  period,
  onConfirm,
  onClose,
  pending,
}: {
  plan: BillingPlan;
  period: BillingPeriod;
  onConfirm: () => void;
  onClose: () => void;
  pending: boolean;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
    <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Test checkout</p>
      <h2 className="mt-2 text-2xl font-bold">Activate {plan.name}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        This mock checkout updates your local subscription only. No card is charged and no payment gateway is contacted.
      </p>
      <div className="mt-5 rounded-md border p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium">{plan.name}</span>
          <span className="font-bold">{formatMoney(period === "yearly" ? plan.yearly_price : plan.monthly_price, period)}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Provider: mock. Ready to swap for Stripe, Paystack, or another gateway later.</p>
      </div>
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 rounded-md border px-4 py-2 text-sm font-semibold hover:bg-muted">
          Back
        </button>
        <button type="button" disabled={pending} onClick={onConfirm} className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {pending ? "Activating..." : "Confirm test plan"}
        </button>
      </div>
    </div>
  </div>
);

const Billing = () => {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlan | null>(null);
  const queryClient = useQueryClient();
  const plansQuery = useQuery({ queryKey: ["billing-plans"], queryFn: listBillingPlansApi });
  const billingQuery = useQuery({ queryKey: ["billing-overview"], queryFn: getBillingOverviewApi });

  const billing = billingQuery.data;
  const currentCode = billing?.plan.code;
  const usageLimits = useMemo(() => billing?.limits.filter((limit) => visibleLimits.includes(limit.key)) ?? [], [billing]);

  const refreshBilling = async () => {
    await queryClient.invalidateQueries({ queryKey: ["billing-overview"] });
    await queryClient.invalidateQueries({ queryKey: ["billing-plans"] });
  };

  const checkoutMutation = useMutation({
    mutationFn: (plan: BillingPlan) => mockCheckoutApi({ plan: plan.code, billing_period: period }),
    onSuccess: async () => {
      toast.success("Subscription updated", { description: "Mock billing changed your plan for local testing." });
      setCheckoutPlan(null);
      await refreshBilling();
    },
    onError: (error) => toast.error(error.message),
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, payload }: { action: "renew" | "cancel" | "resume"; payload?: Record<string, unknown> }) => subscriptionActionApi(action, payload),
    onSuccess: async () => {
      toast.success("Billing status updated");
      await refreshBilling();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border bg-background p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-emerald-700">Current plan</p>
              <h1 className="mt-2 text-3xl font-bold">{billing?.plan.name ?? "Loading..."}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{billing?.plan.description ?? "Checking your billing setup."}</p>
            </div>
            <span className="rounded-md bg-emerald-100 px-3 py-1 text-xs font-bold uppercase text-emerald-800">{billing?.subscription.status ?? "loading"}</span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-md border p-4">
              <p className="text-xs text-muted-foreground">Billing period</p>
              <p className="mt-1 font-semibold capitalize">{billing?.subscription.billing_period ?? period}</p>
            </div>
            <div className="rounded-md border p-4">
              <p className="text-xs text-muted-foreground">Renewal</p>
              <p className="mt-1 font-semibold">{formatDate(billing?.subscription.current_period_end ?? null)}</p>
            </div>
            <div className="rounded-md border p-4">
              <p className="text-xs text-muted-foreground">Trial ends</p>
              <p className="mt-1 font-semibold">{formatDate(billing?.subscription.trial_ends_at ?? null)}</p>
            </div>
          </div>
          {billing?.subscription.cancel_at_period_end && (
            <div className="mt-5 flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              Your plan is set to cancel at the end of this billing period.
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-background p-6">
          <h2 className="text-lg font-bold">Usage</h2>
          <div className="mt-5 space-y-5">
            {usageLimits.map((limit) => (
              <UsageRow key={limit.key} limit={limit} />
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-background p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Change Plan</h2>
            <p className="mt-1 text-sm text-muted-foreground">Use the mock checkout to test upgrades, downgrades, renewals, and cancellations.</p>
          </div>
          <div className="rounded-md border p-1">
            {(["monthly", "yearly"] as BillingPeriod[]).map((next) => (
              <button key={next} type="button" onClick={() => setPeriod(next)} className={`rounded px-4 py-2 text-sm font-semibold capitalize ${period === next ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                {next}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {(plansQuery.data ?? []).map((plan) => {
            const price = period === "yearly" ? plan.yearly_price : plan.monthly_price;
            const isCurrent = currentCode === plan.code;
            return (
              <article key={plan.code} className={`rounded-lg border p-5 ${planTone[plan.code]}`}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  {plan.code === "growth" && <span className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white">Most Popular</span>}
                </div>
                <p className="mt-2 min-h-10 text-sm text-muted-foreground">{plan.description}</p>
                <p className="mt-5 text-3xl font-bold">{formatMoney(price, period)}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {plan.limits.filter((limit) => limit.enabled).slice(0, 6).map((limit) => (
                    <li key={limit.key} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                      <span>{limit.limit == null ? limit.label : `${limit.label}: ${limit.limit}`}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={checkoutMutation.isPending || isCurrent}
                  onClick={() => setCheckoutPlan(plan)}
                  className={`mt-6 w-full rounded-md px-4 py-2 text-sm font-bold ${isCurrent ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90"} disabled:opacity-70`}
                >
                  {isCurrent ? "Current plan" : plan.sort_order > (billing?.plan.sort_order ?? 0) ? "Upgrade" : "Downgrade"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-background p-6">
          <h2 className="text-xl font-bold">Locked Features</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(billing?.locked_features ?? []).slice(0, 10).map((feature) => (
              <div key={feature.key} className="flex items-center gap-3 rounded-md border p-3 text-sm">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <span>{feature.label}</span>
              </div>
            ))}
            {billing?.locked_features.length === 0 && <p className="text-sm text-muted-foreground">Everything is unlocked on this plan.</p>}
          </div>
        </div>
        <div className="rounded-lg border bg-background p-6">
          <h2 className="text-xl font-bold">Billing Controls</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => actionMutation.mutate({ action: "renew" })} className="flex items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm font-semibold hover:bg-muted">
              <RefreshCw className="h-4 w-4" /> Renew now
            </button>
            <button type="button" onClick={() => actionMutation.mutate({ action: "resume" })} className="flex items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm font-semibold hover:bg-muted">
              <ShieldCheck className="h-4 w-4" /> Resume
            </button>
            <button type="button" onClick={() => actionMutation.mutate({ action: "cancel", payload: { at_period_end: true } })} className="flex items-center justify-center gap-2 rounded-md border border-amber-300 px-4 py-3 text-sm font-semibold text-amber-800 hover:bg-amber-50">
              <Zap className="h-4 w-4" /> Cancel at renewal
            </button>
            <button type="button" onClick={() => actionMutation.mutate({ action: "cancel", payload: { at_period_end: false } })} className="flex items-center justify-center gap-2 rounded-md border border-rose-300 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50">
              <Crown className="h-4 w-4" /> Cancel now
            </button>
          </div>
          <p className="mt-4 flex gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-4 w-4 flex-none" />
            These actions are local test controls. A real provider can later drive the same subscription events through webhooks.
          </p>
        </div>
      </section>

      {checkoutPlan && (
        <CheckoutModal
          plan={checkoutPlan}
          period={period}
          pending={checkoutMutation.isPending}
          onClose={() => setCheckoutPlan(null)}
          onConfirm={() => checkoutMutation.mutate(checkoutPlan)}
        />
      )}
    </div>
  );
};

export default Billing;
