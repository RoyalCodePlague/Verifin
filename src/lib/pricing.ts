import type { BillingPlan, PlanCode, PricingContext } from "@/lib/api";

type RegionalPriceDefinition = {
  country_name: string;
  currency: string;
  currency_symbol: string;
  prices: Record<PlanCode, [number, number]>;
};

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

const fallbackRegionalPrices: Record<string, RegionalPriceDefinition> = {
  ZA: { country_name: "South Africa", currency: "ZAR", currency_symbol: "R", prices: { starter: [0, 0], growth: [299, 2990], business: [599, 5990] } },
  ZW: { country_name: "Zimbabwe", currency: "USD", currency_symbol: "$", prices: { starter: [0, 0], growth: [12, 120], business: [24, 240] } },
  BW: { country_name: "Botswana", currency: "BWP", currency_symbol: "P", prices: { starter: [0, 0], growth: [220, 2200], business: [440, 4400] } },
  KE: { country_name: "Kenya", currency: "KES", currency_symbol: "KSh", prices: { starter: [0, 0], growth: [1800, 18000], business: [3600, 36000] } },
  NG: { country_name: "Nigeria", currency: "NGN", currency_symbol: "NGN", prices: { starter: [0, 0], growth: [18000, 180000], business: [36000, 360000] } },
  GH: { country_name: "Ghana", currency: "GHS", currency_symbol: "GHc", prices: { starter: [0, 0], growth: [180, 1800], business: [360, 3600] } },
  TZ: { country_name: "Tanzania", currency: "TZS", currency_symbol: "TSh", prices: { starter: [0, 0], growth: [30000, 300000], business: [60000, 600000] } },
  ZM: { country_name: "Zambia", currency: "ZMW", currency_symbol: "K", prices: { starter: [0, 0], growth: [300, 3000], business: [600, 6000] } },
};

export function fallbackPricingContextForCountry(countryCode: string): PricingContext {
  const country_code = fallbackRegionalPrices[countryCode] ? countryCode : "ZA";
  const region = fallbackRegionalPrices[country_code];

  return {
    country_code,
    country_name: region.country_name,
    currency: region.currency,
    currency_symbol: region.currency_symbol,
    detected_by: "frontend-fallback",
    available_countries: Object.entries(fallbackRegionalPrices).map(([code, country]) => ({
      country_code: code,
      country_name: country.country_name,
      currency: country.currency,
      currency_symbol: country.currency_symbol,
    })),
    prices: fallbackPlans.map((plan) => {
      const [monthly, yearly] = region.prices[plan.code];
      return {
        plan,
        country_code,
        country_name: region.country_name,
        currency: region.currency,
        currency_symbol: region.currency_symbol,
        monthly_price: monthly.toFixed(2),
        yearly_price: yearly.toFixed(2),
      };
    }),
  };
}

export function formatRegionalSampleAmount(zarAmount: number, countryCode?: string) {
  const context = fallbackPricingContextForCountry(countryCode || "ZA");
  const southAfricaGrowth = fallbackRegionalPrices.ZA.prices.growth[0];
  const regionalGrowth = fallbackRegionalPrices[context.country_code].prices.growth[0];
  const converted = zarAmount * (regionalGrowth / southAfricaGrowth);
  const rounded = converted >= 1000 ? Math.round(converted / 10) * 10 : Math.max(1, Math.round(converted));
  return `${context.currency_symbol}${rounded.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
