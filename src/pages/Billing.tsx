import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Gift, Lock, Ticket } from "lucide-react";
import { toast } from "sonner";
import {
  getBillingOverviewApi,
  getPricingContextApi,
  getReferralProgressApi,
  redeemReferralRewardApi,
  subscriptionActionApi,
  type BillingPeriod,
  type FeatureLimit,
  type PlanCode,
} from "@/lib/api";

const planTone: Record<PlanCode, string> = {
  starter: "border-border bg-card dark:bg-card",
  growth: "border-emerald-300 bg-emerald-50/70 dark:border-emerald-700/60 dark:bg-emerald-950/30",
  business: "border-sky-300 bg-sky-50/70 dark:border-sky-700/60 dark:bg-sky-950/30",
};

const formatMoney = (value: string, period: BillingPeriod, symbol = "R") => {
  const amount = Number(value);
  if (amount <= 0) return "Free";
  return `${symbol}${amount.toLocaleString("en-ZA")}/${period === "yearly" ? "year" : "month"}`;
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
      <div className="h-2 overflow-hidden rounded bg-muted dark:bg-muted/40">
        <div className={`h-full rounded ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const Billing = () => {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const queryClient = useQueryClient();
  const online = typeof navigator === "undefined" || navigator.onLine;
  const billingQuery = useQuery({ queryKey: ["billing-overview"], queryFn: getBillingOverviewApi, staleTime: 60_000, refetchInterval: 60_000, enabled: online });
  const pricingQuery = useQuery({ queryKey: ["pricing-context"], queryFn: () => getPricingContextApi(), staleTime: 5 * 60_000, enabled: online });
  const referralsQuery = useQuery({ queryKey: ["referrals"], queryFn: getReferralProgressApi, staleTime: 60_000, enabled: online });

  const billing = billingQuery.data;
  const referrals = referralsQuery.data;
  const currentCode = billing?.plan.code;
  const usageLimits = useMemo(() => billing?.limits.filter((limit) => visibleLimits.includes(limit.key)) ?? [], [billing]);
  const pricing = pricingQuery.data;
  const regionalByPlan = useMemo(() => new Map((pricing?.prices ?? []).map((price) => [price.plan.code, price])), [pricing]);
  const plans = useMemo(() => (pricing?.prices ?? []).map((price) => price.plan), [pricing]);
  const referralLink = useMemo(() => {
    if (!referrals?.code || typeof window === "undefined") return "";
    return `${window.location.origin}/login?signup=1&ref=${encodeURIComponent(referrals.code)}`;
  }, [referrals?.code]);
  const unusedReferralToken = referrals?.tokens.find((token) => token.status === "unused");
  const referralPct = referrals ? Math.min(100, Math.round((referrals.qualified_count / referrals.target) * 100)) : 0;

  const refreshBilling = async () => {
    await queryClient.invalidateQueries({ queryKey: ["billing-overview"] });
    await queryClient.invalidateQueries({ queryKey: ["feature-access"] });
  };

  const actionMutation = useMutation({
    mutationFn: ({ action, payload }: { action: "downgrade"; payload?: Record<string, unknown> }) => subscriptionActionApi(action, payload),
    onSuccess: async () => {
      toast.success("Billing status updated");
      await refreshBilling();
    },
    onError: (error) => toast.error(error.message),
  });

  const redeemReferralMutation = useMutation({
    mutationFn: () => redeemReferralRewardApi(unusedReferralToken?.code),
    onSuccess: async (res) => {
      toast.success(res.detail);
      await queryClient.invalidateQueries({ queryKey: ["billing-overview"] });
    await queryClient.invalidateQueries({ queryKey: ["feature-access"] });
      await queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const copyReferralLink = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    toast.success("Referral link copied");
  };

  return (
    <div className="space-y-8">
      {billing?.subscription.provider === "launch_promo" && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm" role="status">
          <p className="font-semibold">Your free Business launch promotion ends {formatDate(billing.subscription.launch_promo_ends_at)}.</p>
          <p className="mt-2">You will automatically move to free Starter. Your saved business data stays in your account. Premium features will require a paid upgrade. No automatic charges.</p>
        </div>
      )}
      {billing?.subscription.launch_promo_ends_at && billing.subscription.provider === "free" && (
        <p className="rounded-lg border p-4 text-sm">Your account is on free Starter. Your launch promotion cannot be restarted. Premium features require a paid upgrade.</p>
      )}
      {!online && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          Billing needs an internet connection. Your cached business data still works offline, but plan changes and usage checks will resume when you reconnect.
        </div>
      )}
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-border bg-background p-6 dark:bg-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Current plan</p>
              <h1 className="mt-2 text-3xl font-bold">{billing?.plan.name ?? "Loading..."}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{billing?.plan.description ?? "Checking your billing setup."}</p>
            </div>
            <span className="rounded-md bg-emerald-100 px-3 py-1 text-xs font-bold uppercase text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">{billing?.subscription.status ?? "loading"}</span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-muted/20 p-4 dark:bg-muted/10">
              <p className="text-xs text-muted-foreground">Billing period</p>
              <p className="mt-1 font-semibold capitalize">{billing?.subscription.billing_period ?? period}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-4 dark:bg-muted/10">
              <p className="text-xs text-muted-foreground">{billing?.subscription.provider === "launch_promo" ? "Promotion ends" : "Period ends"}</p>
              <p className="mt-1 font-semibold">{formatDate(billing?.subscription.current_period_end ?? null)}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-4 dark:bg-muted/10">
              <p className="text-xs text-muted-foreground">Trial ends</p>
              <p className="mt-1 font-semibold">{formatDate(billing?.subscription.trial_ends_at ?? null)}</p>
            </div>
          </div>
          {billing?.subscription.cancel_at_period_end && (
            <div className="mt-5 flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              Your plan is set to cancel at the end of this billing period.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-background p-6 dark:bg-card">
          <h2 className="text-lg font-bold">Usage</h2>
          <div className="mt-5 space-y-5">
            {usageLimits.map((limit) => (
              <UsageRow key={limit.key} limit={limit} />
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-6 dark:bg-card">
        <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <Gift className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Referral Growth Reward</h2>
                <p className="mt-1 text-sm text-muted-foreground">Invite {referrals?.target ?? 15} verified businesses and unlock Growth for {referrals?.reward_days ?? 90} days.</p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-foreground">{referrals?.qualified_count ?? 0}/{referrals?.target ?? 15} qualified referrals</span>
                <span className="text-muted-foreground">{referrals?.pending_count ?? 0} pending</span>
              </div>
              <div className="h-3 overflow-hidden rounded bg-muted dark:bg-muted/40">
                <div className="h-full rounded bg-emerald-500 transition-all" style={{ width: `${referralPct}%` }} />
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={copyReferralLink}
                disabled={!referralLink}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60 dark:hover:bg-muted/30"
              >
                <Copy className="h-4 w-4" />
                Copy invite link
              </button>
              <button
                type="button"
                onClick={() => redeemReferralMutation.mutate()}
                disabled={!unusedReferralToken || redeemReferralMutation.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                <Ticket className="h-4 w-4" />
                {unusedReferralToken ? "Redeem Growth token" : "No token ready yet"}
              </button>
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-4 dark:bg-muted/10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Your code</p>
            <p className="mt-2 break-all text-2xl font-bold">{referrals?.code ?? "Loading..."}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {unusedReferralToken
                ? `Token ready: ${unusedReferralToken.code}`
                : referrals
                  ? `${referrals.remaining} more qualified referral${referrals.remaining === 1 ? "" : "s"} until your next token.`
                  : "Checking referral progress."}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-6 dark:bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Change Plan</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Paid upgrades are coming soon. No payments are being collected. Prices are shown for {pricing?.country_name ?? "your region"}.
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-1 dark:bg-muted/10">
            {(["monthly", "yearly"] as BillingPeriod[]).map((next) => (
              <button key={next} type="button" onClick={() => setPeriod(next)} className={`rounded px-4 py-2 text-sm font-semibold capitalize transition-colors ${period === next ? "bg-foreground text-background dark:bg-primary dark:text-primary-foreground" : "text-muted-foreground hover:text-foreground dark:hover:bg-muted/30"}`}>
                {next}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => {
            const regional = regionalByPlan.get(plan.code);
            const price = regional ? (period === "yearly" ? regional.yearly_price : regional.monthly_price) : (period === "yearly" ? plan.yearly_price : plan.monthly_price);
            const isCurrent = currentCode === plan.code;
            return (
              <article key={plan.code} className={`rounded-lg border p-5 shadow-soft transition-colors ${planTone[plan.code]}`}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  {plan.code === "growth" && <span className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white">Most Popular</span>}
                </div>
                <p className="mt-2 min-h-10 text-sm text-muted-foreground">{plan.description}</p>
                <p className="mt-5 text-3xl font-bold">{formatMoney(price, period, regional?.currency_symbol ?? pricing?.currency_symbol)}</p>
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
                  disabled={actionMutation.isPending || !billing || isCurrent || plan.code !== "starter"}
                  onClick={() => actionMutation.mutate({ action: "downgrade", payload: { plan: "starter" } })}
                  className={`mt-6 w-full rounded-md px-4 py-2 text-sm font-bold transition-colors ${isCurrent ? "bg-muted text-muted-foreground dark:bg-muted/40" : "bg-primary text-primary-foreground hover:bg-primary/90"} disabled:opacity-70`}
                >
                  {isCurrent ? "Current plan" : plan.code === "starter" ? "End premium and switch to Starter now" : "Paid upgrades coming soon"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-6 dark:bg-card">
          <h2 className="text-xl font-bold">Locked Features</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(billing?.locked_features ?? []).slice(0, 10).map((feature) => (
              <div key={feature.key} className="flex items-center gap-3 rounded-md border border-border bg-muted/20 p-3 text-sm dark:bg-muted/10">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <span>{feature.label}</span>
              </div>
            ))}
            {billing?.locked_features.length === 0 && <p className="text-sm text-muted-foreground">Everything is unlocked on this plan.</p>}
          </div>
        </div>
      </section>

    </div>
  );
};

export default Billing;
