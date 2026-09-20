import { useQuery } from "@tanstack/react-query";
import { getPricingContextApi } from "@/lib/api";

export function LaunchPromotion() {
  const { data } = useQuery({ queryKey: ["pricing-context"], queryFn: () => getPricingContextApi(), staleTime: 60_000 });
  if (!data?.launch_promotion?.enabled) return null;
  return <div className="mb-5 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm" role="note">
    <p className="font-semibold">Launch promotion: {data.launch_promotion.days} days of premium free</p>
    <p className="mt-2">Your Business plan starts when you sign up. After {data.launch_promotion.days} days, your account automatically moves to the free Starter plan. Continuing premium features requires a paid upgrade.</p>
    <p className="mt-2">No card required. No automatic charges. Paid upgrades are coming soon.</p>
  </div>;
}
