import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getBillingOverviewApi, type FeatureAccess } from "@/lib/api";

export const FEATURE_LABELS: Record<string, string> = {
  barcode_scanning: "Barcode scanning",
  audits: "Inventory audits",
  advanced_reports: "Advanced reports",
  advanced_analytics: "Advanced analytics",
  forecasting: "Forecasting",
  whatsapp_reports: "WhatsApp summaries",
  command_assistant: "Command assistant",
  offline_sync: "Offline sync",
  role_based_access: "Role-based access",
  multi_branch: "Multi-branch",
};

export function useFeatureAccess() {
  const query = useQuery({ queryKey: ["billing-overview"], queryFn: getBillingOverviewApi, staleTime: 60_000 });
  const features = query.data?.features ?? [];
  const byKey = useMemo(() => new Map(features.map((feature) => [feature.key, feature])), [features]);

  const canUse = (key: string) => byKey.get(key)?.enabled ?? false;
  const feature = (key: string): FeatureAccess | undefined => byKey.get(key);

  return { ...query, features, canUse, feature, plan: query.data?.plan, limits: query.data?.limits ?? [] };
}

export function useUpgradePrompt() {
  const navigate = useNavigate();
  return (featureKey: string, label?: string) => {
    toast.warning(`${label || FEATURE_LABELS[featureKey] || "This feature"} is locked on your current plan.`, {
      description: "Open Billing to see the plan that unlocks it.",
      action: { label: "Billing", onClick: () => navigate("/billing") },
    });
  };
}

export function LockedBadge({ label = "Locked" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold text-muted-foreground">
      <Lock className="h-3 w-3" />
      {label}
    </span>
  );
}
