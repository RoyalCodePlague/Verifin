import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardCheck, AlertTriangle, CheckCircle, XCircle, Check, Square, PlayCircle, Loader2, Zap, Search, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useStore, type AuditRecord, type Discrepancy } from "@/lib/store";
import { addToOfflineQueue, canQueueOfflineAction, isOnline } from "@/lib/offlineQueue";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { createAuditApi, createDiscrepancyApi, resolveDiscrepancyApi, updateAuditApi } from "@/lib/api";
import { useNavigate } from "react-router-dom";

function formatAuditDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function mapApiAuditToRecord(
  audit: { id: number; date: string; status: "in_progress" | "completed"; items_counted: number; discrepancies_found: number },
  existing?: AuditRecord
): AuditRecord {
  return {
    id: String(audit.id),
    date: formatAuditDate(audit.date),
    status: audit.status,
    items: audit.items_counted,
    discrepancies: audit.discrepancies_found,
    conductor: existing?.conductor || "You",
    autoFindings: existing?.autoFindings || [],
  };
}

function mapApiDiscrepancyToRecord(discrepancy: {
  id: number;
  audit?: number;
  product_name?: string;
  expected_stock: number;
  actual_stock: number;
  difference: number;
  status: Discrepancy["status"];
}): Discrepancy {
  return {
    id: String(discrepancy.id),
    auditId: discrepancy.audit ? String(discrepancy.audit) : undefined,
    product: discrepancy.product_name || "Product",
    expected: discrepancy.expected_stock,
    actual: discrepancy.actual_stock,
    diff: discrepancy.difference,
    status: discrepancy.status,
  };
}

const Audits = () => {
  const {
    audits,
    discrepancies,
    products,
    resolveDiscrepancy,
    addAudit,
    upsertAudit,
    updateAudit,
    addDiscrepancy,
    upsertDiscrepancy,
    profile,
    addActivity,
  } = useStore();
  const navigate = useNavigate();
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [countOpen, setCountOpen] = useState<string | null>(null);
  const [stockCounts, setStockCounts] = useState<Record<string, string>>({});
  const [bgAuditId, setBgAuditId] = useState<string | null>(null);
  const [bgProgress, setBgProgress] = useState(0);
  const [bgFindings, setBgFindings] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "in_progress" | "completed">("all");
  const [viewFindings, setViewFindings] = useState<string | null>(null);
  const bgIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sym = profile.currencySymbol || "R";

  const openDisc = discrepancies.filter((d) => d.status !== "resolved");
  const outOfStockCount = products.filter((product) => product.status === "out").length;
  const lowStockCount = products.filter((product) => product.status === "low").length;
  const highValueCount = products.filter((product) => product.stock > 0 && product.costPrice * product.stock > 5000).length;
  const accuracy = products.length > 0 ? Math.round(((products.length - openDisc.length) / products.length) * 100) : 100;
  const lossValue = openDisc.reduce((sum, d) => {
    const prod = products.find((p) => p.name === d.product);
    return sum + Math.abs(d.diff) * (prod?.costPrice || 0);
  }, 0);
  const backgroundFlaggedItems = useMemo(() => {
    return products
      .filter((product) => product.status === "low" || product.status === "out" || (product.stock > 0 && product.costPrice * product.stock > 5000))
      .map((product) => {
        const reorderGap = Math.max(product.reorder - product.stock, 0);
        const reorderCost = reorderGap * (product.costPrice || 0);
        const reasons = [
          product.status === "out" ? "Out of stock" : null,
          product.status === "low" ? "Low stock" : null,
          product.stock > 0 && product.costPrice * product.stock > 5000 ? "High value" : null,
        ].filter(Boolean) as string[];

        return {
          id: product.id,
          name: product.name,
          stock: product.stock,
          reorder: product.reorder,
          reorderGap,
          reorderCost,
          stockValueAtCost: product.stock * (product.costPrice || 0),
          reasons,
        };
      })
      .sort((a, b) => {
        const aPriority = a.reasons.includes("Out of stock") ? 0 : a.reasons.includes("Low stock") ? 1 : 2;
        const bPriority = b.reasons.includes("Out of stock") ? 0 : b.reasons.includes("Low stock") ? 1 : 2;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return b.stockValueAtCost - a.stockValueAtCost;
      });
  }, [products]);
  const estimatedReorderCost = backgroundFlaggedItems.reduce((sum, item) => sum + item.reorderCost, 0);
  const repeatIssueProducts = useMemo(() => {
    const counts = discrepancies.reduce<Record<string, number>>((acc, discrepancy) => {
      acc[discrepancy.product] = (acc[discrepancy.product] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts)
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [discrepancies]);

  const copyRestockList = async () => {
    const restockItems = backgroundFlaggedItems.filter((item) => item.reorderGap > 0);
    if (restockItems.length === 0) {
      toast.info("No restock list to copy yet.");
      return;
    }

    const message = [
      "Verifin Restock List",
      ...restockItems.map((item) => `${item.name} - need ${item.reorderGap} more units`),
    ].join("\n");

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(message);
        toast.success("Restock list copied to clipboard.");
        return;
      }
    } catch {
      // ignore clipboard failure and fall through to a lighter confirmation
    }

    toast.success("Restock list prepared.", { description: "Clipboard access was unavailable on this device." });
  };

  useEffect(() => {
    return () => {
      if (bgIntervalRef.current) clearInterval(bgIntervalRef.current);
    };
  }, []);

  const startAudit = async () => {
    const localAudit: Omit<AuditRecord, "id"> = {
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      status: "in_progress",
      items: products.length,
      discrepancies: 0,
      conductor: "You",
      autoFindings: [],
    };

    let auditId: string;

    if (canQueueOfflineAction()) {
      auditId = addAudit(localAudit);
      addToOfflineQueue({
        type: "audit_create",
        payload: {
          local_id: auditId,
          status: "in_progress",
          items_counted: products.length,
          discrepancies_found: 0,
        },
      });
    } else if (isOnline()) {
      try {
        const created = await createAuditApi({
          status: "in_progress",
          items_counted: products.length,
          discrepancies_found: 0,
        });
        auditId = String(created.id);
        upsertAudit(mapApiAuditToRecord(created));
      } catch (error) {
        toast.error("Could not start audit.", {
          description: error instanceof Error ? error.message : "Please try again.",
        });
        return;
      }
    } else {
      auditId = addAudit(localAudit);
    }

    toast.success("New audit started!");
    setBgAuditId(auditId);
    setBgProgress(0);
    setBgFindings([]);

    const findings: string[] = [];
    let progress = 0;
    const totalSteps = Math.max(products.length, 1);
    let step = 0;

    if (bgIntervalRef.current) clearInterval(bgIntervalRef.current);

    bgIntervalRef.current = setInterval(() => {
      step++;
      progress = Math.min(Math.round((step / totalSteps) * 100), 100);
      setBgProgress(progress);

      const product = products[step - 1];
      if (product) {
        if (product.status === "out") {
          findings.push(`Warning: ${product.name} is out of stock and needs immediate restocking`);
        } else if (product.status === "low") {
          findings.push(`Low stock: ${product.name} is at ${product.stock}/${product.reorder}, reorder soon`);
        }
        if (product.stock > 0 && product.costPrice * product.stock > 5000) {
          findings.push(`High value: ${product.name} currently holds ${sym}${(product.stock * product.costPrice).toLocaleString()}, verify count`);
        }
        setBgFindings([...findings]);
      }

      if (step >= totalSteps) {
        if (bgIntervalRef.current) clearInterval(bgIntervalRef.current);
        bgIntervalRef.current = null;
        const lowItems = products.filter((p) => p.status === "low" || p.status === "out");
        const autoDiscs = lowItems.length;
        updateAudit(auditId, { autoFindings: findings });
        addActivity({ text: `Background audit completed: ${findings.length} findings, ${autoDiscs} items flagged`, time: "Just now", type: "alert" });
        toast.success("Background audit complete!", { description: `${findings.length} findings detected across ${totalSteps} products.` });
      }
    }, 600);
  };

  const filteredAudits = audits.filter((a) => {
    const matchesSearch = a.date.toLowerCase().includes(search.toLowerCase()) || a.conductor.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredDisc = discrepancies.filter((d) => d.status !== "resolved" && d.product.toLowerCase().includes(search.toLowerCase()));
  const viewingAudit = audits.find((a) => a.id === viewFindings);
  const auditDiscrepancies = viewingAudit ? discrepancies.filter((discrepancy) => discrepancy.auditId === viewingAudit.id) : [];
  const auditOpenIssues = auditDiscrepancies.filter((discrepancy) => discrepancy.status !== "resolved");
  const auditLossValue = auditDiscrepancies.reduce((sum, discrepancy) => {
    const product = products.find((item) => item.name === discrepancy.product);
    return sum + Math.abs(discrepancy.diff) * (product?.costPrice || 0);
  }, 0);

  const openStockCount = (auditId: string) => {
    const counts: Record<string, string> = {};
    products.forEach((p) => {
      counts[p.id] = "";
    });
    setStockCounts(counts);
    setCountOpen(auditId);
  };

  const handleSubmitCounts = async (auditId: string) => {
    const onlineAudit = /^\d+$/.test(auditId) && isOnline() && !canQueueOfflineAction();
    let discCount = 0;

    for (const p of products) {
      const actualStr = stockCounts[p.id];
      if (actualStr === "" || actualStr === undefined) continue;

      const actual = parseInt(actualStr, 10);
      if (isNaN(actual) || actual === p.stock) continue;

      if (onlineAudit && /^\d+$/.test(p.id)) {
        try {
          const created = await createDiscrepancyApi({
            audit: parseInt(auditId, 10),
            product: parseInt(p.id, 10),
            expected_stock: p.stock,
            actual_stock: actual,
            difference: actual - p.stock,
            status: "unresolved",
          });
          upsertDiscrepancy(mapApiDiscrepancyToRecord(created));
        } catch (error) {
          toast.error(`Could not save discrepancy for ${p.name}.`, {
            description: error instanceof Error ? error.message : "Please try again.",
          });
          return;
        }
      } else {
        addDiscrepancy({ auditId: auditId, product: p.name, expected: p.stock, actual, diff: actual - p.stock, status: "unresolved" });
      }

      if (canQueueOfflineAction()) {
        addToOfflineQueue({
          type: "discrepancy_create",
          payload: {
            audit_local_id: auditId,
            audit: /^\d+$/.test(auditId) ? parseInt(auditId, 10) : undefined,
            product: /^\d+$/.test(p.id) ? parseInt(p.id, 10) : undefined,
            product_name: p.name,
            expected_stock: p.stock,
            actual_stock: actual,
            difference: actual - p.stock,
          },
        });
      }

      discCount++;
    }

    updateAudit(auditId, { discrepancies: discCount, status: "completed" });

    if (onlineAudit) {
      try {
        const updated = await updateAuditApi(auditId, {
          status: "completed",
          items_counted: products.length,
          discrepancies_found: discCount,
        });
        const existingAudit = audits.find((audit) => audit.id === auditId);
        upsertAudit(mapApiAuditToRecord(updated, existingAudit));
      } catch (error) {
        toast.error("Could not finish this audit.", {
          description: error instanceof Error ? error.message : "Please try again.",
        });
        return;
      }
    } else if (canQueueOfflineAction()) {
      addToOfflineQueue({
        type: "audit_update",
        payload: {
          local_id: auditId,
          id: /^\d+$/.test(auditId) ? parseInt(auditId, 10) : undefined,
          status: "completed",
          items_counted: products.length,
          discrepancies_found: discCount,
        },
      });
    }

    addActivity({ text: `Audit completed: ${discCount} discrepancies found`, time: "Just now", type: "alert" });
    setCountOpen(null);
    toast.success(canQueueOfflineAction() ? `Audit saved locally. ${discCount} discrepancies will sync when online.` : `Audit completed! ${discCount} discrepancies found.`);
  };

  const handleCompleteAudit = async (auditId: string) => {
    updateAudit(auditId, { status: "completed" });

    if (/^\d+$/.test(auditId) && isOnline() && !canQueueOfflineAction()) {
      try {
        const updated = await updateAuditApi(auditId, { status: "completed" });
        const existingAudit = audits.find((audit) => audit.id === auditId);
        upsertAudit(mapApiAuditToRecord(updated, existingAudit));
      } catch (error) {
        toast.error("Could not update this audit.", {
          description: error instanceof Error ? error.message : "Please try again.",
        });
        return;
      }
    } else if (canQueueOfflineAction()) {
      addToOfflineQueue({
        type: "audit_update",
        payload: {
          local_id: auditId,
          id: /^\d+$/.test(auditId) ? parseInt(auditId, 10) : undefined,
          status: "completed",
        },
      });
    }

    addActivity({ text: "Audit marked as completed", time: "Just now", type: "alert" });
    setCompleteId(null);
    toast.success(canQueueOfflineAction() ? "Audit update saved locally. It will sync when you are back online." : "Audit marked as completed!");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">Track stock accuracy and resolve discrepancies</p>
        <Button onClick={() => void startAudit()} className="bg-gradient-hero text-primary-foreground"><ClipboardCheck className="mr-2 h-4 w-4" /> Start New Audit</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="shadow-soft"><CardContent className="p-4 text-center"><CheckCircle className="mx-auto mb-1 h-6 w-6 text-success" /><p className="text-xl font-display font-bold">{accuracy}%</p><p className="text-xs text-muted-foreground">Stock Accuracy</p></CardContent></Card>
        <Card className="shadow-soft"><CardContent className="p-4 text-center"><AlertTriangle className="mx-auto mb-1 h-6 w-6 text-warning" /><p className="text-xl font-display font-bold">{openDisc.length}</p><p className="text-xs text-muted-foreground">Open Issues</p></CardContent></Card>
        <Card className="shadow-soft"><CardContent className="p-4 text-center"><XCircle className="mx-auto mb-1 h-6 w-6 text-destructive" /><p className="text-xl font-display font-bold">{sym}{lossValue.toLocaleString()}</p><p className="text-xs text-muted-foreground">Loss Value</p></CardContent></Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search audits, discrepancies..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          {(["all", "in_progress", "completed"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {s === "all" ? "All" : s === "in_progress" ? "In Progress" : "Completed"}
            </button>
          ))}
        </div>
      </div>

      {bgProgress > 0 && bgProgress < 100 && (
        <Card className="border-primary/20 shadow-soft">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium">Background Audit Running...</p>
              <span className="ml-auto text-sm font-display font-bold text-primary">{bgProgress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <motion.div className="h-full rounded-full bg-gradient-hero" initial={{ width: 0 }} animate={{ width: `${bgProgress}%` }} transition={{ duration: 0.3 }} />
            </div>
            {bgFindings.length > 0 && (
              <div className="mt-3 max-h-32 space-y-1 overflow-y-auto">
                {bgFindings.slice(-3).map((f, i) => <p key={i} className="text-xs text-muted-foreground">{f}</p>)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {bgProgress === 100 && bgFindings.length > 0 && (
        <Card className="border-success/20 shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-display text-success"><Zap className="h-4 w-4" /> Background Audit Results</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <div className="rounded border border-border bg-muted/30 p-2 text-center">
                <p className="text-lg font-display font-bold">{outOfStockCount}</p>
                <p className="text-[11px] text-muted-foreground">Out</p>
              </div>
              <div className="rounded border border-border bg-muted/30 p-2 text-center">
                <p className="text-lg font-display font-bold">{lowStockCount}</p>
                <p className="text-[11px] text-muted-foreground">Low</p>
              </div>
              <div className="rounded border border-border bg-muted/30 p-2 text-center">
                <p className="text-lg font-display font-bold">{highValueCount}</p>
                <p className="text-[11px] text-muted-foreground">High value</p>
              </div>
              <div className="rounded border border-border bg-muted/30 p-2 text-center">
                <p className="text-lg font-display font-bold">{sym}{estimatedReorderCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                <p className="text-[11px] text-muted-foreground">Reorder cost</p>
              </div>
              <div className="rounded border border-border bg-muted/30 p-2 text-center">
                <p className="text-lg font-display font-bold">{repeatIssueProducts.length}</p>
                <p className="text-[11px] text-muted-foreground">Repeat issues</p>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void copyRestockList()}>
                Copy Restock List
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate("/inventory?view=flagged")}>
                Open Inventory
              </Button>
            </div>
            {repeatIssueProducts.length > 0 ? (
              <div className="mb-3 rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">Repeat issue warnings</p>
                <div className="mt-2 space-y-1">
                  {repeatIssueProducts.map(([product, count]) => (
                    <p key={product} className="text-xs text-muted-foreground">
                      {product} has appeared in {count} audit discrepancies.
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
            {backgroundFlaggedItems.length > 0 ? (
              <div className="mb-3 rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">Flagged items</p>
                <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
                  {backgroundFlaggedItems.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded bg-muted/30 p-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{item.name}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Stock: {item.stock} | Reorder at: {item.reorder} | Reasons: {item.reasons.join(", ")}
                          </p>
                        </div>
                        {item.reorderGap > 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            Need {item.reorderGap}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {bgFindings.map((f, i) => <p key={i} className="rounded bg-muted/30 p-2 text-xs text-muted-foreground">{f}</p>)}
            </div>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => { setBgProgress(0); setBgFindings([]); }}>Dismiss</Button>
          </CardContent>
        </Card>
      )}

      {filteredDisc.length > 0 && (
        <Card className="shadow-soft">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base font-display text-destructive"><AlertTriangle className="h-4 w-4" /> Active Discrepancies</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {filteredDisc.map((d, i) => (
                <motion.div key={d.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">{d.product}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Expected: {d.expected} - Actual: {d.actual}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-display font-bold text-destructive">{d.diff}</p>
                      <Badge className={d.status === "unresolved" ? "bg-destructive/10 text-destructive hover:bg-destructive/10" : "bg-warning/10 text-warning hover:bg-warning/10"}>{d.status}</Badge>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setResolveId(d.id)}><Check className="mr-1 h-3.5 w-3.5" /> Resolve</Button>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-soft">
        <CardHeader className="pb-2"><CardTitle className="text-base font-display">Audit History</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filteredAudits.map((a) => (
              <div key={a.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-medium">{a.date}</p>
                  <p className="text-xs text-muted-foreground">By {a.conductor} - {a.items} items</p>
                  {a.autoFindings && a.autoFindings.length > 0 && (
                    <button onClick={() => setViewFindings(a.id)} className="mt-0.5 flex items-center gap-1 text-xs text-primary hover:underline">
                      <Eye className="h-3 w-3" /> {a.autoFindings.length} auto-findings
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <Badge className={a.status === "completed" ? "bg-success/10 text-success hover:bg-success/10" : "bg-accent/10 text-accent hover:bg-accent/10"}>{a.status === "completed" ? "Completed" : "In Progress"}</Badge>
                    {a.discrepancies > 0 && <p className="mt-1 text-xs text-destructive">{a.discrepancies} discrepancies</p>}
                  </div>
                  <div className="flex gap-1">
                    {a.status === "completed" ? (
                      <Button size="sm" variant="outline" onClick={() => setViewFindings(a.id)}>
                        <Eye className="mr-1 h-3.5 w-3.5" /> View
                      </Button>
                    ) : null}
                  {a.status === "in_progress" && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => openStockCount(a.id)}><PlayCircle className="mr-1 h-3.5 w-3.5" /> Count</Button>
                      <Button size="sm" variant="outline" onClick={() => setCompleteId(a.id)}><Square className="mr-1 h-3.5 w-3.5" /> Close</Button>
                    </div>
                  )}
                  </div>
                </div>
              </div>
            ))}
            {filteredAudits.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">No audits match your search.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!viewFindings} onOpenChange={() => setViewFindings(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Audit Findings - {viewingAudit?.date}</DialogTitle>
            <DialogDescription>Review the saved findings, issue count, and estimated stock loss for this audit.</DialogDescription>
          </DialogHeader>
          {viewingAudit && (
            <div className="space-y-3">
              <div className="flex gap-3 text-sm">
                <Badge className={viewingAudit.status === "completed" ? "bg-success/10 text-success hover:bg-success/10" : "bg-accent/10 text-accent hover:bg-accent/10"}>{viewingAudit.status}</Badge>
                <span className="text-muted-foreground">{viewingAudit.items} items - {viewingAudit.discrepancies} discrepancies</span>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-xs text-muted-foreground">Open issues</p>
                  <p className="text-sm font-medium">{auditOpenIssues.length}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Estimated loss</p>
                  <p className="text-sm font-medium">{sym}{auditLossValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>
              {auditDiscrepancies.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Linked discrepancies</p>
                  {auditDiscrepancies.map((discrepancy) => (
                    <div key={discrepancy.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{discrepancy.product}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Expected: {discrepancy.expected} - Actual: {discrepancy.actual} - Difference: {discrepancy.diff}
                          </p>
                        </div>
                        <Badge className={discrepancy.status === "resolved" ? "bg-success/10 text-success hover:bg-success/10" : "bg-destructive/10 text-destructive hover:bg-destructive/10"}>
                          {discrepancy.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {viewingAudit.autoFindings && viewingAudit.autoFindings.length > 0 ? (
                <div className="space-y-2">
                  {viewingAudit.autoFindings.map((f, i) => (
                    <div key={i} className="rounded-lg bg-muted/30 p-3 text-sm">{f}</div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No auto-findings recorded for this audit.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!countOpen} onOpenChange={() => setCountOpen(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Stock Count</DialogTitle>
            <DialogDescription>Enter actual stock counts for each product. Leave blank to skip.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {products.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 p-2">
                <div className="flex-1">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">Expected: {p.stock}</p>
                </div>
                <Input type="number" placeholder="Actual" value={stockCounts[p.id] || ""} onChange={(e) => setStockCounts({ ...stockCounts, [p.id]: e.target.value })} className="w-24" />
              </div>
            ))}
            <Button onClick={() => countOpen && void handleSubmitCounts(countOpen)} className="w-full bg-gradient-hero text-primary-foreground">Submit Counts & Complete Audit</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationModal
        open={!!resolveId}
        onOpenChange={() => setResolveId(null)}
        title="Resolve Discrepancy"
        description="Mark this discrepancy as resolved?"
        confirmLabel="Resolve"
        onConfirm={() => {
          if (resolveId) {
            const resolved = discrepancies.find((d) => d.id === resolveId);
            resolveDiscrepancy(resolveId);
            if (/^\d+$/.test(resolveId) && isOnline() && !canQueueOfflineAction()) {
              resolveDiscrepancyApi(resolveId).catch(() => {
                toast.warning("Discrepancy was marked resolved locally, but the server update did not complete.");
              });
            } else if (canQueueOfflineAction() && /^\d+$/.test(resolveId)) {
              addToOfflineQueue({ type: "discrepancy_resolve", payload: { id: parseInt(resolveId, 10) } });
            }
            addActivity({ text: `Discrepancy resolved${resolved ? `: ${resolved.product}` : ""}`, time: "Just now", type: "alert" });
            toast.success(canQueueOfflineAction() ? "Discrepancy resolution saved locally." : "Discrepancy resolved!", { description: resolved ? `${resolved.product} was marked as resolved.` : undefined });
          }
          setResolveId(null);
        }}
      />
      <ConfirmationModal open={!!completeId} onOpenChange={() => setCompleteId(null)} title="Complete Audit" description="Mark this audit as completed? Any unsubmitted stock counts will not be recorded." confirmLabel="Complete" onConfirm={() => { if (completeId) void handleCompleteAudit(completeId); }} />
    </div>
  );
};

export default Audits;
