import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Gift, Lock, Ticket, X } from "lucide-react";
import { toast } from "sonner";
import {
  getBillingOverviewApi,
  getPricingContextApi,
  getProviderStatusApi,
  getPaynowStatusApi,
  paynowCheckoutApi,
  paynowMobileCheckoutApi,
  getReferralProgressApi,
  redeemReferralRewardApi,
  subscriptionActionApi,
  type BillingPeriod,
  type FeatureLimit,
  type PlanCode,
  type PaynowMobileMethod,
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
  const [period, setPeriod] = useState<BillingPeriod>(() => {
    const requested = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("period");
    return requested === "yearly" ? "yearly" : "monthly";
  });
  const [pricingCountry] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("country")?.toUpperCase() ?? "");
  const [requestedPlan] = useState<PlanCode | "">(() => {
    const requested = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("plan");
    return requested === "growth" || requested === "business" || requested === "starter" ? requested : "";
  });
  const [paymentReference, setPaymentReference] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("payment_reference") ?? "");
  const [checkoutPlan, setCheckoutPlan] = useState<PlanCode | null>(null);
  const [checkoutMethod, setCheckoutMethod] = useState<"hosted" | "mobile">("hosted");
  const [paymentMethod, setPaymentMethod] = useState<PaynowMobileMethod>("ecocash");
  const [mobileNumber, setMobileNumber] = useState("");
  const queryClient = useQueryClient();
  const online = typeof navigator === "undefined" || navigator.onLine;
  const billingQuery = useQuery({ queryKey: ["billing-overview"], queryFn: getBillingOverviewApi, staleTime: 60_000, refetchInterval: 60_000, enabled: online });
  const pricingQuery = useQuery({ queryKey: ["pricing-context", pricingCountry], queryFn: () => getPricingContextApi(pricingCountry || undefined), staleTime: 5 * 60_000, enabled: online });
  const referralsQuery = useQuery({ queryKey: ["referrals"], queryFn: getReferralProgressApi, staleTime: 60_000, enabled: online });
  const providersQuery = useQuery({ queryKey: ["billing-providers"], queryFn: getProviderStatusApi, staleTime: 30_000, enabled: online });
  const paynow = providersQuery.data?.providers.find((provider) => provider.provider === "paynow");
  const paymentStatusQuery = useQuery({
    queryKey: ["paynow-status", paymentReference],
    queryFn: () => getPaynowStatusApi(paymentReference),
    enabled: online && Boolean(paymentReference),
    refetchInterval: (query) => query.state.data?.status === "pending" ? 5000 : false,
  });

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

  const checkoutMutation = useMutation({
    mutationFn: paynowMobileCheckoutApi,
    onSuccess: (result) => {
      setPaymentReference(result.reference);
      const url = new URL(window.location.href);
      url.searchParams.set("payment_reference", result.reference);
      window.history.replaceState({}, "", url);
      setCheckoutPlan(null);
      toast.success(`Check ${result.phone} and approve the ${result.method === "ecocash" ? "EcoCash" : "OneMoney"} prompt.`);
    },
    onError: (error) => toast.error(error.message),
  });

  const hostedCheckoutMutation = useMutation({
    mutationFn: paynowCheckoutApi,
    onSuccess: (result) => {
      window.location.assign(result.redirect_url);
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    const status = paymentStatusQuery.data?.status;
    if (!status || !paymentReference) return;
    if (status === "paid") {
      toast.success("Payment confirmed. Your plan is active.");
      void refreshBilling();
    }
    if (status === "failed") toast.error("Paynow did not complete this payment.");
    if (status !== "pending") {
      setPaymentReference("");
      const url = new URL(window.location.href);
      url.searchParams.delete("payment_reference");
      window.history.replaceState({}, "", url);
    }
  }, [paymentStatusQuery.data?.status, paymentReference]);

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
          <p className="mt-2">You will automatically move to free Starter. Your saved business data stays in your account. Business plan features will require a paid upgrade. No automatic charges.</p>
        </div>
      )}
      {billing?.subscription.launch_promo_ends_at && billing.subscription.provider === "free" && (
        <p className="rounded-lg border p-4 text-sm">Your account is on free Starter. Your launch promotion cannot be restarted. Business plan features require a paid upgrade.</p>
      )}
      {!online && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          Billing needs an internet connection. Your cached business data still works offline, but plan changes and usage checks will resume when you reconnect.
        </div>
      )}
      {paymentReference && paymentStatusQuery.data?.status === "pending" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          Waiting for Paynow to confirm your payment. This page will update automatically.
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
              {paynow?.ready && paynow.enabled && pricing?.currency === "USD"
                ? `Choose secure Paynow checkout for cards, Zimswitch and other available methods, or use an EcoCash or OneMoney prompt. Prices are shown for ${pricing?.country_name ?? "your region"}.`
                : `Paynow checkout is available for eligible USD plans when Paynow is enabled and configured. Prices are shown for ${pricing?.country_name ?? "your region"}.`}
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
            const canPay = Boolean(paynow?.enabled && paynow.ready && regional?.currency === "USD");
            return (
              <article key={plan.code} className={`rounded-lg border p-5 shadow-soft transition-colors ${planTone[plan.code]} ${requestedPlan === plan.code ? "ring-2 ring-primary ring-offset-2" : ""}`}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  {plan.code === "growth" && <span className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white">Most Popular</span>}
                </div>
                {requestedPlan === plan.code && <p className="mt-2 text-xs font-semibold text-primary">Selected from Pricing</p>}
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
                  disabled={actionMutation.isPending || checkoutMutation.isPending || hostedCheckoutMutation.isPending || !billing || isCurrent || (plan.code === "starter" ? false : !canPay)}
                  onClick={() => plan.code === "starter"
                    ? actionMutation.mutate({ action: "downgrade", payload: { plan: "starter" } })
                    : (setCheckoutMethod("hosted"), setCheckoutPlan(plan.code))}
                  className={`mt-6 w-full rounded-md px-4 py-2 text-sm font-bold transition-colors ${isCurrent ? "bg-muted text-muted-foreground dark:bg-muted/40" : "bg-primary text-primary-foreground hover:bg-primary/90"} disabled:opacity-70`}
                >
                  {isCurrent ? "Current plan" : plan.code === "starter" ? "Switch to Starter now" : canPay ? "Choose payment method" : "Paynow setup pending"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {checkoutPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCheckoutPlan(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="paynow-checkout-title" className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl dark:bg-card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="paynow-checkout-title" className="text-xl font-bold">Choose payment method</h2>
                <p className="mt-1 text-sm text-muted-foreground">Pay securely with Paynow. Verifin does not collect or store card details.</p>
              </div>
              <button type="button" onClick={() => setCheckoutPlan(null)} aria-label="Close checkout" className="rounded-md p-2 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <form className="mt-6 space-y-4" onSubmit={(event) => {
              event.preventDefault();
              const selectedPrice = regionalByPlan.get(checkoutPlan);
              if (checkoutMethod === "hosted") {
                hostedCheckoutMutation.mutate({
                  plan: checkoutPlan,
                  billing_period: period,
                  country_code: selectedPrice?.country_code ?? pricing?.country_code,
                });
              } else {
                checkoutMutation.mutate({
                  plan: checkoutPlan,
                  billing_period: period,
                  country_code: selectedPrice?.country_code ?? pricing?.country_code,
                  method: paymentMethod,
                  phone: mobileNumber,
                });
              }
            }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <button type="button" aria-pressed={checkoutMethod === "hosted"} onClick={() => setCheckoutMethod("hosted")} className={`rounded-lg border p-4 text-left transition-colors ${checkoutMethod === "hosted" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/40"}`}>
                  <span className="block text-sm font-bold">Card, Zimswitch &amp; more</span>
                  <span className="mt-1 block text-xs text-muted-foreground">Choose from the payment methods enabled on Paynow.</span>
                </button>
                <button type="button" aria-pressed={checkoutMethod === "mobile"} onClick={() => setCheckoutMethod("mobile")} className={`rounded-lg border p-4 text-left transition-colors ${checkoutMethod === "mobile" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/40"}`}>
                  <span className="block text-sm font-bold">Mobile money</span>
                  <span className="mt-1 block text-xs text-muted-foreground">Get an EcoCash or OneMoney approval prompt.</span>
                </button>
              </div>
              {checkoutMethod === "mobile" ? (
                <>
                  <label className="block space-y-1.5 text-sm font-medium" htmlFor="paynow-method">
                    <span>Mobile money provider</span>
                    <select id="paynow-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaynowMobileMethod)} className="w-full rounded-md border border-border bg-background px-3 py-2.5 dark:bg-muted/20">
                      <option value="ecocash">EcoCash</option>
                      <option value="onemoney">OneMoney</option>
                    </select>
                  </label>
                  <label className="block space-y-1.5 text-sm font-medium" htmlFor="paynow-phone">
                    <span>Mobile number</span>
                    <input id="paynow-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0771234567" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} required pattern="(?:\\+?263|0)?7[0-9]{8}" title="Enter a Zimbabwe mobile number, such as 0771234567." className="w-full rounded-md border border-border bg-background px-3 py-2.5 dark:bg-muted/20" />
                  </label>
                  <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">Paynow will send a prompt to your phone. Enter your mobile money PIN on your handset to approve the payment.</p>
                </>
              ) : (
                <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">You’ll continue to Paynow’s secure checkout, where you can choose an available card, Zimswitch or other payment method.</p>
              )}
              {checkoutMutation.isError && checkoutMethod === "mobile" && <p className="text-sm text-destructive" role="alert">{checkoutMutation.error.message}</p>}
              {hostedCheckoutMutation.isError && checkoutMethod === "hosted" && <p className="text-sm text-destructive" role="alert">{hostedCheckoutMutation.error.message}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setCheckoutPlan(null)} className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
                <button type="submit" disabled={checkoutMutation.isPending || hostedCheckoutMutation.isPending} className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                  {checkoutMutation.isPending ? "Sending prompt…" : hostedCheckoutMutation.isPending ? "Opening Paynow…" : checkoutMethod === "hosted" ? "Continue to Paynow" : "Send payment prompt"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

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
