import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getPricingContextApi } from "@/lib/api";

export function LaunchPromotion() {
  const { data } = useQuery({ queryKey: ["pricing-context"], queryFn: () => getPricingContextApi(), staleTime: 60_000 });
  const enabled = data?.launch_promotion?.enabled;
  const days = data?.launch_promotion?.days;

  useEffect(() => {
    if (!enabled || !days) return;
    const id = toast.info(`Get ${days} days of the Business plan free`, {
      id: "signup-business-promotion",
      description: `Your Business plan starts when you sign up. After ${days} days, your account moves to the free Starter plan.`,
      duration: 10000,
      closeButton: true,
    });
    return () => { toast.dismiss(id); };
  }, [enabled, days]);

  return null;
}
