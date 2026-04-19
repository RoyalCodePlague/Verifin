import { useEffect, useState } from "react";
import { closeTillApi, createSaleApi, deleteSaleApi, fetchReceiptApi, getCurrentTillApi, openTillApi, type ApiTillSession } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { addToOfflineQueue, canQueueOfflineAction } from "@/lib/offlineQueue";
import { motion } from "framer-motion";
import { Plus, Search, ArrowUpRight, Trash2, ShoppingCart, Receipt, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";

interface SaleLineItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

const Sales = () => {
  const { sales, deleteSale, profile, products, addSale } = useStore();
  const { refreshUser } = useAuth();
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [tillOpen, setTillOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptText, setReceiptText] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [till, setTill] = useState<ApiTillSession | null>(null);
  const [tillForm, setTillForm] = useState({ cashier: "", openingCash: "0", closingCash: "" });
  const [method, setMethod] = useState<"Cash" | "EFT" | "Card">("Cash");
  const [lineItems, setLineItems] = useState<SaleLineItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [qty, setQty] = useState("1");
  const sym = profile.currencySymbol || "R";

  useEffect(() => {
    getCurrentTillApi().then(setTill).catch(() => setTill(null));
  }, []);

  const filtered = sales.filter(s => s.items.toLowerCase().includes(search.toLowerCase()));
  const todayTotal = sales.filter(s => s.date === "Today").reduce((sum, s) => sum + s.total, 0);
  const todayCount = sales.filter(s => s.date === "Today").length;

  const addLineItem = () => {
    const product = products.find(p => p.id === selectedProduct);
    if (!product) return;
    const quantity = parseInt(qty) || 1;
    if (quantity > product.stock) {
      toast.error(`Only ${product.stock} ${product.name} in stock`);
      return;
    }
    const existing = lineItems.findIndex(l => l.productId === product.id);
    if (existing >= 0) {
      const newItems = [...lineItems];
      newItems[existing].quantity += quantity;
      if (newItems[existing].quantity > product.stock) {
        toast.error(`Only ${product.stock} ${product.name} in stock`);
        return;
      }
      setLineItems(newItems);
    } else {
      setLineItems([...lineItems, { productId: product.id, productName: product.name, quantity, unitPrice: product.price }]);
    }
    setSelectedProduct("");
    setQty("1");
  };

  const removeLineItem = (idx: number) => setLineItems(lineItems.filter((_, i) => i !== idx));

  const saleTotal = lineItems.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  const createOfflineSale = () => {
    addSale({
      items: lineItems.map((l) => `${l.quantity} ${l.productName}`).join(", "),
      total: saleTotal,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      date: "Today",
      method,
      saleItems: lineItems,
    });
  };

  const handleAdd = async () => {
    if (lineItems.length === 0) return;
    setSaving(true);

    const apiPayload = {
      payment_method: method,
      branch: null,
      till_session: till?.id || null,
      customer: null,
      sale_items: lineItems.map((l) => ({
        product: parseInt(l.productId, 10),
        quantity: l.quantity,
        unit_price: l.unitPrice.toFixed(2),
        subtotal: (l.quantity * l.unitPrice).toFixed(2),
      })),
    };
    const offlinePayload = {
      payment_method: method,
      customer: null,
      sale_items: lineItems.map((l) => {
        const productId = parseInt(l.productId, 10);
        return {
          product: Number.isFinite(productId) ? productId : null,
          product_local_id: l.productId,
          product_name: l.productName,
          quantity: l.quantity,
          unit_price: l.unitPrice.toFixed(2),
          subtotal: (l.quantity * l.unitPrice).toFixed(2),
        };
      }),
    };

    if (!navigator.onLine && !canQueueOfflineAction()) {
      toast.error("Offline mode is available after you have signed in on this device.");
      setSaving(false);
      return;
    }

    if (canQueueOfflineAction()) {
      createOfflineSale();
      addToOfflineQueue({ type: "sale", payload: offlinePayload });
      toast.success("Sale saved locally while offline. It will sync automatically when you are back online.");
      setLineItems([]);
      setMethod("Cash");
      setAddOpen(false);
      setSaving(false);
      return;
    }

    try {
      await createSaleApi(apiPayload);
      toast.success("Sale recorded & inventory updated!");
      setLineItems([]);
      setMethod("Cash");
      setAddOpen(false);
      await refreshUser();
    } catch (e) {
      if (canQueueOfflineAction()) {
        createOfflineSale();
        addToOfflineQueue({ type: "sale", payload: offlinePayload });
        toast.success("Sale saved locally. It will sync automatically when you are back online.");
      } else {
        toast.error(e instanceof Error ? e.message : "Could not record sale");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleOpenTill = async () => {
    try {
      const opened = await openTillApi({
        branch: null,
        cashier_name: tillForm.cashier,
        opening_cash: tillForm.openingCash || "0",
      });
      setTill(opened);
      setTillOpen(false);
      toast.success("Till opened");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open till");
    }
  };

  const handleCloseTill = async () => {
    if (!till) return;
    try {
      const closed = await closeTillApi(till.id, { closing_cash: tillForm.closingCash || "0" });
      setTill(null);
      setTillOpen(false);
      toast.success(`Till closed. Variance: ${sym}${Number(closed.cash_variance).toLocaleString()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not close till");
    }
  };

  const showReceipt = async (id: string) => {
    try {
      const receipt = await fetchReceiptApi(id);
      const lines = [
        receipt.business_name || "Verifin Receipt",
        receipt.branch ? `Branch: ${receipt.branch}` : "",
        `Receipt: ${receipt.receipt_number}`,
        receipt.invoice_number ? `Invoice: ${receipt.invoice_number}` : "",
        `${receipt.date} ${receipt.time}`,
        `Payment: ${receipt.payment_method}`,
        "",
        ...receipt.items.map((item) => `${item.quantity} ${item.product_name || "Item"} - ${sym}${Number(item.subtotal || 0).toLocaleString()}`),
        "",
        `Total: ${sym}${Number(receipt.total).toLocaleString()}`,
      ].filter(Boolean);
      setReceiptText(lines.join("\n"));
      setReceiptOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load receipt");
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: "Today's Sales", value: `${sym}${todayTotal.toLocaleString()}`, change: "+12%" },
          { label: "Transactions", value: String(todayCount), change: `+${todayCount}` },
          { label: "Avg. Transaction", value: `${sym}${todayCount > 0 ? Math.round(todayTotal / todayCount) : 0}`, change: "+5%" },
        ].map((m) => (
          <Card key={m.label} className="shadow-soft">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-xl font-display font-bold mt-1">{m.value}</p>
              <span className="text-xs text-success flex items-center gap-0.5 mt-1"><ArrowUpRight className="h-3 w-3" /> {m.change}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-soft">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><Wallet className="h-4 w-4 text-primary" /></div>
            <div>
              <p className="text-sm font-medium">{till ? `Till open - ${till.cashier_name || "Cashier"}` : "No till session open"}</p>
              <p className="text-xs text-muted-foreground">{till ? `Opening cash: ${sym}${Number(till.opening_cash).toLocaleString()}` : "Open a till to track cash variance for the shift."}</p>
            </div>
          </div>
          <Button variant={till ? "outline" : "default"} onClick={() => setTillOpen(true)}>{till ? "Close Till" : "Open Till"}</Button>
        </CardContent>
      </Card>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search sales..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={() => setAddOpen(true)} className="bg-gradient-hero text-primary-foreground"><Plus className="h-4 w-4 mr-2" /> Record Sale</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No sales yet" description="Record your first sale to see it here" actionLabel="Record Sale" onAction={() => setAddOpen(true)} />
      ) : (
        <Card className="shadow-soft">
          <CardHeader className="pb-2"><CardTitle className="text-base font-display">Transactions</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {filtered.map((s, i) => (
                <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors group">
                  <div>
                    <p className="font-medium text-sm">{s.items}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.time} · {s.date} · {s.method}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="font-display font-bold">{sym}{s.total.toLocaleString()}</p>
                    <button onClick={() => showReceipt(s.id)} className="p-1.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"><Receipt className="h-3.5 w-3.5 text-muted-foreground" /></button>
                    <button onClick={() => setDeleteId(s.id)} className="p-1.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-display">Record Sale</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Add line items */}
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label>Product</Label>
                <select value={selectedProduct} onChange={e => setSelectedProduct(e.target.value)} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Select product...</option>
                  {products.filter(p => p.stock > 0).map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.stock} in stock)</option>
                  ))}
                </select>
              </div>
              <div className="w-20">
                <Label>Qty</Label>
                <Input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} className="mt-1" />
              </div>
              <Button type="button" variant="outline" onClick={addLineItem} disabled={!selectedProduct} className="mb-0">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Line items list */}
            {lineItems.length > 0 && (
              <div className="border border-border rounded-lg divide-y divide-border">
                {lineItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 text-sm">
                    <div>
                      <span className="font-medium">{item.quantity}x {item.productName}</span>
                      <span className="text-muted-foreground ml-2">@ {sym}{item.unitPrice}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-display font-semibold">{sym}{(item.quantity * item.unitPrice).toLocaleString()}</span>
                      <button onClick={() => removeLineItem(idx)} className="p-1 rounded hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between p-3 bg-muted/30 font-display font-bold">
                  <span>Total</span>
                  <span>{sym}{saleTotal.toLocaleString()}</span>
                </div>
              </div>
            )}

            <div>
              <Label>Payment Method</Label>
              <select value={method} onChange={e => setMethod(e.target.value as "Cash" | "EFT" | "Card")} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="Cash">Cash</option>
                <option value="EFT">EFT</option>
                <option value="Card">Card</option>
              </select>
            </div>
            <Button onClick={handleAdd} disabled={lineItems.length === 0 || saving} className="w-full bg-gradient-hero text-primary-foreground">
              {saving ? "Saving…" : `Record Sale — ${sym}${saleTotal.toLocaleString()}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={tillOpen} onOpenChange={setTillOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display">{till ? "Close Till" : "Open Till"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {!till ? (
              <>
                {/*
                Multiple branches are disabled for now. Keep this field for later reactivation.
                <div><Label>Branch</Label><select value={tillForm.branch} onChange={e => setTillForm({ ...tillForm, branch: e.target.value })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="">No branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                */}
                <div><Label>Cashier Name</Label><Input value={tillForm.cashier} onChange={e => setTillForm({ ...tillForm, cashier: e.target.value })} className="mt-1" /></div>
                <div><Label>Opening Cash ({sym})</Label><Input type="number" value={tillForm.openingCash} onChange={e => setTillForm({ ...tillForm, openingCash: e.target.value })} className="mt-1" /></div>
                <Button onClick={handleOpenTill} className="w-full">Open Till</Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Cash sales: {sym}{Number(till.cash_sales || 0).toLocaleString()}</p>
                <div><Label>Actual Cash Counted ({sym})</Label><Input type="number" value={tillForm.closingCash} onChange={e => setTillForm({ ...tillForm, closingCash: e.target.value })} className="mt-1" /></div>
                <Button onClick={handleCloseTill} className="w-full">Close Till</Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display">Receipt</DialogTitle></DialogHeader>
          <pre className="rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap">{receiptText}</pre>
          <Button variant="outline" onClick={() => navigator.clipboard.writeText(receiptText)}>Copy Receipt</Button>
        </DialogContent>
      </Dialog>
      <ConfirmationModal
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Delete Sale"
        description="Remove this sale record?"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!deleteId) return;
          try {
            await deleteSaleApi(deleteId);
            deleteSale(deleteId);
            await refreshUser();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not delete sale");
          }
          setDeleteId(null);
        }}
      />
    </div>
  );
};

export default Sales;
