import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Clock3, Lightbulb, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFeatureAccess, useUpgradePrompt } from "@/lib/features";
import {
  fetchBusinessInsightsApi,
  updateBusinessInsightApi,
  type ApiBusinessInsight,
} from "@/lib/api";

type InsightsTab = "active" | "history";

const severityStyles: Record<ApiBusinessInsight["severity"], string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  info: "border-primary/20 bg-primary/5 text-primary",
};

const readableLabel = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const displayValue = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        return [row.name || row.product || row.description, ...Object.entries(row)
          .filter(([key]) => !["id", "name", "product", "description"].includes(key))
          .map(([key, itemValue]) => `${readableLabel(key)}: ${String(itemValue)}`)]
          .filter(Boolean)
          .join(" · ");
      }
      return String(item);
    }).join("; ");
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
};

function InsightCard({
  insight,
  onAction,
  busy,
}: {
  insight: ApiBusinessInsight;
  onAction: (id: number, action: "acknowledge" | "dismiss") => void;
  busy: boolean;
}) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{insight.title}</CardTitle>
            <p className="text-sm text-muted-foreground">{insight.explanation}</p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${severityStyles[insight.severity]}`}>
            {readableLabel(insight.severity)} priority
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />
          <span>{insight.period_label}</span>
          <span aria-hidden="true">·</span>
          <span className="capitalize">{readableLabel(insight.status)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.keys(insight.supporting_figures).length > 0 && (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(insight.supporting_figures).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-muted/50 p-3">
                <dt className="text-xs text-muted-foreground">{readableLabel(key)}</dt>
                <dd className="mt-1 break-words text-sm font-medium">{displayValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {insight.recommended_action && (
          <p className="text-sm">
            <span className="font-medium">Recommended action: </span>
            <span className="text-muted-foreground">{insight.recommended_action}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {insight.link && (
            <Button asChild size="sm" variant="outline">
              <Link to={insight.link}>
                View related records <ArrowUpRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          )}
          {insight.status === "active" && (
            <>
              <Button size="sm" onClick={() => onAction(insight.id, "acknowledge")} disabled={busy}>
                <Check className="mr-1 h-4 w-4" /> Acknowledge
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onAction(insight.id, "dismiss")} disabled={busy}>
                <X className="mr-1 h-4 w-4" /> Dismiss
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Insights() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<InsightsTab>("active");
  const { canUse } = useFeatureAccess();
  const promptUpgrade = useUpgradePrompt();
  const enabled = canUse("rule_insights");
  const query = useQuery({
    queryKey: ["business-insights", tab],
    queryFn: () => fetchBusinessInsightsApi(tab === "history" ? "all" : "active"),
    enabled,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "acknowledge" | "dismiss" }) =>
      updateBusinessInsightApi(id, action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["business-insights"] });
      toast.success("Insight updated.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update this insight."),
  });

  if (!enabled) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <Lightbulb className="h-10 w-10 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">VERIFIN INSIGHTS</h2>
            <p className="mt-1 text-sm text-muted-foreground">Rules-based business insights are available on an eligible plan.</p>
          </div>
          <Button onClick={() => promptUpgrade("rule_insights", "VERIFIN INSIGHTS")}>Explore plans</Button>
        </CardContent>
      </Card>
    );
  }

  const items = query.data?.items || [];
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-primary">VERIFIN INSIGHTS</p>
          <h1 className="mt-1 text-2xl font-bold">Findings from your business records</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            These rule-based observations use recorded sales, expenses, inventory, account activity, and balances.
            Comparisons identify whether the periods are complete or partial.
          </p>
          {query.data?.currency && (
            <p className="mt-1 text-xs text-muted-foreground">
              Monetary figures use your base currency ({query.data.currency}).
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant={tab === "active" ? "default" : "outline"} onClick={() => setTab("active")}>
            Current
          </Button>
          <Button variant={tab === "history" ? "default" : "outline"} onClick={() => setTab("history")}>
            History
          </Button>
        </div>
      </div>

      {query.isLoading && <p className="text-sm text-muted-foreground">Checking recorded business activity…</p>}
      {query.isError && (
        <Card><CardContent className="py-6 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Insights could not be loaded."}
        </CardContent></Card>
      )}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Lightbulb className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">{tab === "active" ? "No current findings" : "No insight history yet"}</p>
            <p className="max-w-lg text-sm text-muted-foreground">
              {tab === "active"
                ? "There are no findings supported by the available records right now. New observations appear as your business data changes."
                : "Generated, acknowledged, dismissed, and resolved findings will be kept here."}
            </p>
          </CardContent>
        </Card>
      )}
      <div className="space-y-4">
        {items.map((insight) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            busy={mutation.isPending}
            onAction={(id, action) => mutation.mutate({ id, action })}
          />
        ))}
      </div>
    </div>
  );
}
