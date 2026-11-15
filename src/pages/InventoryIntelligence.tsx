import { useEffect, useMemo, useState } from "react";
import { Search, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchInventoryIntelligenceApi, type ApiInventoryIntelligenceItem } from "@/lib/api";
import { symbolForCurrency } from "@/lib/currency";
import { toast } from "sonner";

type IntelligenceReport = Awaited<ReturnType<typeof fetchInventoryIntelligenceApi>>;
type Filter = "all" | "fast" | "slow" | "non_moving" | "dead" | "low";

const InventoryIntelligence = () => {
  const [report, setReport] = useState<IntelligenceReport | null>(null);
  const [days, setDays] = useState(90);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const currency = report?.currency || "USD";
  const sym = symbolForCurrency(currency);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchInventoryIntelligenceApi(days)
      .then((data) => {
        if (active) setReport(data);
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? `Could not load inventory intelligence: ${error.message}` : "Could not load inventory intelligence.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [days]);

  const visibleItems = useMemo(() => (report?.items || []).filter((item) => {
    const matchesSearch = `${item.product_name} ${item.sku} ${item.category} ${item.preferred_supplier}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all"
      || (filter === "dead" ? item.dead_stock : filter === "low" ? item.status !== "ok" : item.movement_class === filter);
    return matchesSearch && matchesFilter;
  }), [filter, report, search]);

  const money = (value: string | number | null | undefined) => (
    `${sym}${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );
  const ageQuantity = (item: ApiInventoryIntelligenceItem) => (
    item.ageing.over_90?.quantity || 0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Inventory intelligence</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stock valuation, recorded sales velocity, purchase-cost history, ageing, and reorder signals. Recommendations never place orders or change prices.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            aria-label="Sales analysis period"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
            <option value={365}>Last year</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Inventory valuation</p><p className="mt-1 text-lg font-semibold">{money(report?.summary.inventory_value_base)}</p><p className="text-xs text-muted-foreground">Base-currency cost basis</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Fast moving</p><p className="mt-1 text-lg font-semibold">{report?.summary.fast_moving_count ?? 0}</p><p className="text-xs text-muted-foreground">≥1 net unit/day</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Slow moving</p><p className="mt-1 text-lg font-semibold">{report?.summary.slow_moving_count ?? 0}</p><p className="text-xs text-muted-foreground">Positive sales below 1/day</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Non-moving</p><p className="mt-1 text-lg font-semibold">{report?.summary.non_moving_count ?? 0}</p><p className="text-xs text-muted-foreground">No net sales in window</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Dead stock</p><p className="mt-1 text-lg font-semibold">{report?.summary.dead_stock_count ?? 0}</p><p className="text-xs text-muted-foreground">Stock without recent activity</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Reorder alerts</p><p className="mt-1 text-lg font-semibold">{report?.summary.low_stock_count ?? 0}</p><p className="text-xs text-muted-foreground">At or below minimum stock</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4" /> Product analysis</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" className="pl-9" />
              </div>
              <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} aria-label="Filter inventory report" className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All products</option><option value="fast">Fast moving</option><option value="slow">Slow moving</option><option value="non_moving">Non-moving</option><option value="dead">Dead stock</option><option value="low">Reorder alerts</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading recorded inventory data…</p> : visibleItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No products match this report filter.</p>
          ) : (
            <div className="space-y-3">
              {visibleItems.map((item) => (
                <div key={item.product_id} className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{item.product_name}</p>
                      <Badge variant={item.status === "out" ? "destructive" : item.status === "low" ? "outline" : "secondary"}>{item.status === "ok" ? item.movement_class.replace("_", " ") : item.status}</Badge>
                      {item.dead_stock && <Badge variant="destructive">Dead stock</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.sku} · {item.category || "Uncategorized"} · {item.preferred_supplier || "No preferred supplier"}</p>
                  </div>
                  <Metric label="On hand / minimum" value={`${item.stock} / ${item.reorder_level}`} />
                  <Metric label="Net sold / day" value={Number(item.average_daily_sales).toFixed(2)} />
                  <Metric label="Stock valuation" value={money(item.inventory_value_base)} />
                  <Metric label="Gross profit / turnover" value={`${money(item.gross_profit)} / ${item.stock_turnover ?? "—"}`} />
                  <div className="lg:col-span-5">
                    <p className="text-xs text-muted-foreground">
                      Ageing: 0–30d {item.ageing["0_30"]?.quantity || 0} · 31–60d {item.ageing["31_60"]?.quantity || 0} · 61–90d {item.ageing["61_90"]?.quantity || 0} · over 90d {ageQuantity(item)} · untracked {item.untracked_quantity}
                      {" · "}Weighted purchase cost {item.average_purchase_cost_base ? money(item.average_purchase_cost_base) : "not recorded"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Turnover is net units sold divided by estimated average stock for this window; it is unavailable when a stock adjustment makes the opening stock unreconstructable. Tracked stock uses batch costs; untracked stock uses the current recorded cost.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}

export default InventoryIntelligence;
