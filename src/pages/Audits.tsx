import { useState } from "react";
import { motion } from "framer-motion";
import { ClipboardCheck, AlertTriangle, CheckCircle, XCircle, Check, Square, PlayCircle, Loader2, Zap, Search, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { addToOfflineQueue, canQueueOfflineAction } from "@/lib/offlineQueue";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useEffect, useRef } from "react";

const Audits = () => {
  const { audits, discrepancies, products, resolveDiscrepancy, addAudit, updateAudit, addDiscrepancy, profile, addActivity } = useStore();
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

  const openDisc = discrepancies.filter(d => d.status !== "resolved");
  const accuracy = products.length > 0 ? Math.round(((products.length - openDisc.length) / products.length) * 100) : 100;
  const lossValue = openDisc.reduce((sum, d) => {
    const prod = products.find(p => p.name === d.product);
    return sum + Math.abs(d.diff) * (prod?.price || 0);
  }, 0);

  useEffect(() => {
    return () => {
      if (bgIntervalRef.current) clearInterval(bgIntervalRef.current);
    };
  }, []);

  const startAudit = () => {
    const auditId = addAudit({ date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), status: "in_progress", items: products.length, discrepancies: 0, conductor: "You", autoFindings: [] });
    if (canQueueOfflineAction()) {
      addToOfflineQueue({
        type: "audit_create",
        payload: {
          local_id: auditId,
          status: "in_progress",
          items_counted: products.length,
          discrepancies_found: 0,
        },
      });
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
          findings.push(`⚠ ${product.name}: OUT OF STOCK — needs immediate restocking`);
        } else if (product.status === "low") {
          findings.push(`⚡ ${product.name}: LOW STOCK (${product.stock}/${product.reorder}) — order soon`);
        }
        if (product.stock > 0 && product.price * product.stock > 5000) {
          findings.push(`📊 ${product.name}: High value item (${sym}${(product.stock * product.price).toLocaleString()}) — verify count`);
        }
        setBgFindings([...findings]);
      }

      if (step >= totalSteps) {
        if (bgIntervalRef.current) clearInterval(bgIntervalRef.current);
        bgIntervalRef.current = null;
        const lowItems = products.filter(p => p.status === "low" || p.status === "out");
        const autoDiscs = lowItems.length;
        updateAudit(auditId, { autoFindings: findings });
        addActivity({ text: `Background audit completed: ${findings.length} findings, ${autoDiscs} items flagged`, time: "Just now", type: "alert" });
        toast.success(`Background audit complete!`, { description: `${findings.length} findings detected across ${totalSteps} products.` });
      }
    }, 600);
  };

  const filteredAudits = audits.filter(a => {
    const matchesSearch = a.date.toLowerCase().includes(search.toLowerCase()) || a.conductor.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredDisc = discrepancies.filter(d => d.status !== "resolved" && d.product.toLowerCase().includes(search.toLowerCase()));

  const viewingAudit = audits.find(a => a.id === viewFindings);

  const openStockCount = (auditId: string) => {
    const counts: Record<string, string> = {};
    products.forEach(p => { counts[p.id] = ""; });
    setStockCounts(counts);
    setCountOpen(auditId);
  };

  const handleSubmitCounts = (auditId: string) => {
    let discCount = 0;
    products.forEach(p => {
      const actualStr = stockCounts[p.id];
      if (actualStr !== "" && actualStr !== undefined) {
        const actual = parseInt(actualStr);
        if (!isNaN(actual) && actual !== p.stock) {
          addDiscrepancy({ product: p.name, expected: p.stock, actual, diff: actual - p.stock, status: "unresolved" });
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
      }
    });
    updateAudit(auditId, { discrepancies: discCount, status: "completed" });
    if (canQueueOfflineAction()) {
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

  const handleCompleteAudit = (auditId: string) => {
    updateAudit(auditId, { status: "completed" });
    if (canQueueOfflineAction()) {
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
        <Button onClick={startAudit} className="bg-gradient-hero text-primary-foreground"><ClipboardCheck className="h-4 w-4 mr-2" /> Start New Audit</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="shadow-soft"><CardContent className="p-4 text-center"><CheckCircle className="h-6 w-6 text-success mx-auto mb-1" /><p className="text-xl font-display font-bold">{accuracy}%</p><p className="text-xs text-muted-foreground">Stock Accuracy</p></CardContent></Card>
        <Card className="shadow-soft"><CardContent className="p-4 text-center"><AlertTriangle className="h-6 w-6 text-warning mx-auto mb-1" /><p className="text-xl font-display font-bold">{openDisc.length}</p><p className="text-xs text-muted-foreground">Open Issues</p></CardContent></Card>
        <Card className="shadow-soft"><CardContent className="p-4 text-center"><XCircle className="h-6 w-6 text-destructive mx-auto mb-1" /><p className="text-xl font-display font-bold">{sym}{lossValue.toLocaleString()}</p><p className="text-xs text-muted-foreground">Loss Value</p></CardContent></Card>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search audits, discrepancies..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          {(["all", "in_progress", "completed"] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {s === "all" ? "All" : s === "in_progress" ? "In Progress" : "Completed"}
            </button>
          ))}
        </div>
      </div>

      {/* Background Audit Progress */}
      {bgProgress > 0 && bgProgress < 100 && (
        <Card className="shadow-soft border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
              <p className="text-sm font-medium">Background Audit Running...</p>
              <span className="ml-auto text-sm font-display font-bold text-primary">{bgProgress}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <motion.div className="h-full bg-gradient-hero rounded-full" initial={{ width: 0 }} animate={{ width: `${bgProgress}%` }} transition={{ duration: 0.3 }} />
            </div>
            {bgFindings.length > 0 && (
              <div className="mt-3 space-y-1 max-h-32 overflow-y-auto">
                {bgFindings.slice(-3).map((f, i) => <p key={i} className="text-xs text-muted-foreground">{f}</p>)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {bgProgress === 100 && bgFindings.length > 0 && (
        <Card className="shadow-soft border-success/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display text-success flex items-center gap-2"><Zap className="h-4 w-4" /> Background Audit Results</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {bgFindings.map((f, i) => <p key={i} className="text-xs text-muted-foreground p-2 rounded bg-muted/30">{f}</p>)}
            </div>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => { setBgProgress(0); setBgFindings([]); }}>Dismiss</Button>
          </CardContent>
        </Card>
      )}

      {filteredDisc.length > 0 && (
        <Card className="shadow-soft">
          <CardHeader className="pb-2"><CardTitle className="text-base font-display text-destructive flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Active Discrepancies</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {filteredDisc.map((d, i) => (
                <motion.div key={d.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{d.product}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Expected: {d.expected} · Actual: {d.actual}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-display font-bold text-destructive">{d.diff}</p>
                      <Badge className={d.status === "unresolved" ? "bg-destructive/10 text-destructive hover:bg-destructive/10" : "bg-warning/10 text-warning hover:bg-warning/10"}>{d.status}</Badge>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setResolveId(d.id)}><Check className="h-3.5 w-3.5 mr-1" /> Resolve</Button>
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
              <div key={a.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{a.date}</p>
                  <p className="text-xs text-muted-foreground">By {a.conductor} · {a.items} items</p>
                  {a.autoFindings && a.autoFindings.length > 0 && (
                    <button onClick={() => setViewFindings(a.id)} className="text-xs text-primary mt-0.5 hover:underline flex items-center gap-1">
                      <Eye className="h-3 w-3" /> {a.autoFindings.length} auto-findings
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <Badge className={a.status === "completed" ? "bg-success/10 text-success hover:bg-success/10" : "bg-accent/10 text-accent hover:bg-accent/10"}>{a.status === "completed" ? "Completed" : "In Progress"}</Badge>
                    {a.discrepancies > 0 && <p className="text-xs text-destructive mt-1">{a.discrepancies} discrepancies</p>}
                  </div>
                  {a.status === "in_progress" && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => openStockCount(a.id)}><PlayCircle className="h-3.5 w-3.5 mr-1" /> Count</Button>
                      <Button size="sm" variant="outline" onClick={() => setCompleteId(a.id)}><Square className="h-3.5 w-3.5 mr-1" /> Close</Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {filteredAudits.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">No audits match your search.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* View Findings Dialog */}
      <Dialog open={!!viewFindings} onOpenChange={() => setViewFindings(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Audit Findings — {viewingAudit?.date}</DialogTitle></DialogHeader>
          {viewingAudit && (
            <div className="space-y-3">
              <div className="flex gap-3 text-sm">
                <Badge className={viewingAudit.status === "completed" ? "bg-success/10 text-success hover:bg-success/10" : "bg-accent/10 text-accent hover:bg-accent/10"}>{viewingAudit.status}</Badge>
                <span className="text-muted-foreground">{viewingAudit.items} items · {viewingAudit.discrepancies} discrepancies</span>
              </div>
              {viewingAudit.autoFindings && viewingAudit.autoFindings.length > 0 ? (
                <div className="space-y-2">
                  {viewingAudit.autoFindings.map((f, i) => (
                    <div key={i} className="text-sm p-3 rounded-lg bg-muted/30">{f}</div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No auto-findings recorded for this audit.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Stock Count Dialog */}
      <Dialog open={!!countOpen} onOpenChange={() => setCountOpen(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Stock Count</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">Enter actual stock counts for each product. Leave blank to skip.</p>
          <div className="space-y-3">
            {products.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-muted/30">
                <div className="flex-1">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">Expected: {p.stock}</p>
                </div>
                <Input type="number" placeholder="Actual" value={stockCounts[p.id] || ""} onChange={e => setStockCounts({ ...stockCounts, [p.id]: e.target.value })} className="w-24" />
              </div>
            ))}
            <Button onClick={() => countOpen && handleSubmitCounts(countOpen)} className="w-full bg-gradient-hero text-primary-foreground">Submit Counts & Complete Audit</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationModal open={!!resolveId} onOpenChange={() => setResolveId(null)} title="Resolve Discrepancy" description="Mark this discrepancy as resolved?" confirmLabel="Resolve" onConfirm={() => {
        if (resolveId) {
          const resolved = discrepancies.find(d => d.id === resolveId);
          resolveDiscrepancy(resolveId);
          if (canQueueOfflineAction() && /^\d+$/.test(resolveId)) {
            addToOfflineQueue({ type: "discrepancy_resolve", payload: { id: parseInt(resolveId, 10) } });
          }
          addActivity({ text: `Discrepancy resolved${resolved ? `: ${resolved.product}` : ""}`, time: "Just now", type: "alert" });
          toast.success(canQueueOfflineAction() ? "Discrepancy resolution saved locally." : "Discrepancy resolved!", { description: resolved ? `${resolved.product} was marked as resolved.` : undefined });
        }
        setResolveId(null);
      }} />
      <ConfirmationModal open={!!completeId} onOpenChange={() => setCompleteId(null)} title="Complete Audit" description="Mark this audit as completed? Any unsubmitted stock counts will not be recorded." confirmLabel="Complete" onConfirm={() => { if (completeId) handleCompleteAudit(completeId); }} />
    </div>
  );
};

export default Audits;
