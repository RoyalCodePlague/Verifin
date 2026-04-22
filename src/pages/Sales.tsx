import { useEffect, useMemo, useRef, useState } from "react";
import { closeTillApi, createSaleApi, deleteSaleApi, fetchReceiptApi, getCurrentTillApi, openTillApi, type ApiTillSession } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { addToOfflineQueue, canQueueOfflineAction } from "@/lib/offlineQueue";
import { motion } from "framer-motion";
import { Plus, Search, ArrowUpRight, Trash2, ShoppingCart, Receipt, Wallet, ScanBarcode } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { toast } from "sonner";
import { symbolForCurrency } from "@/lib/currency";
import { useFeatureAccess, useUpgradePrompt } from "@/lib/features";

interface SaleLineItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

const SHOW_TILL_CONTROLS = false;
const SHOW_SPLIT_PAYMENT = false;

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

const Sales = () => {
  const { sales, deleteSale, profile, products, addSale } = useStore();
  const { refreshUser } = useAuth();
  const { canUse } = useFeatureAccess();
  const promptUpgrade = useUpgradePrompt();
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [tillOpen, setTillOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptText, setReceiptText] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [till, setTill] = useState<ApiTillSession | null>(null);
  const [tillForm, setTillForm] = useState({ cashier: "", openingCash: "0", closingCash: "" });
  const [method, setMethod] = useState<"Cash" | "EFT" | "Card">("Cash");
  const [lineItems, setLineItems] = useState<SaleLineItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [qty, setQty] = useState("1");
  const [paymentCurrency, setPaymentCurrency] = useState(profile.currency);
  const [paymentRate, setPaymentRate] = useState("");
  const [canUseCameraScan, setCanUseCameraScan] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const baseCurrency = profile.currency || "ZAR";
  const sym = profile.currencySymbol || symbolForCurrency(baseCurrency);
  const enabledCurrencies = profile.enabledCurrencies?.length ? profile.enabledCurrencies : [baseCurrency];
  const secondaryCurrency = enabledCurrencies.find((code) => code !== baseCurrency) || "";

  useEffect(() => {
    if (!SHOW_TILL_CONTROLS) return;
    getCurrentTillApi().then(setTill).catch(() => setTill(null));
  }, []);

  useEffect(() => {
    setPaymentCurrency(profile.currency);
  }, [profile.currency]);

  useEffect(() => {
    const updateCameraSupport = () => {
      setCanUseCameraScan(!!navigator.mediaDevices?.getUserMedia);
    };
    updateCameraSupport();
    window.addEventListener("resize", updateCameraSupport);
    return () => window.removeEventListener("resize", updateCameraSupport);
  }, []);

  useEffect(() => {
    if (!addOpen) return;
    const timeout = window.setTimeout(() => {
      barcodeInputRef.current?.focus();
      barcodeInputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(timeout);
  }, [addOpen]);

  const filtered = sales.filter(s => s.items.toLowerCase().includes(search.toLowerCase()));
  const todayTotal = sales.filter(s => s.date === "Today").reduce((sum, s) => sum + s.total, 0);
  const todayCount = sales.filter(s => s.date === "Today").length;
  const saleTotal = lineItems.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const alternateCurrency = SHOW_SPLIT_PAYMENT
    ? paymentCurrency === baseCurrency ? secondaryCurrency : baseCurrency
    : "";
  const paymentFxRate = paymentCurrency === baseCurrency
    ? 1
    : parseFloat(paymentRate) || profile.exchangeRates?.[paymentCurrency] || 0;
  const alternateFxRate = alternateCurrency
    ? alternateCurrency === baseCurrency
      ? 1
      : profile.exchangeRates?.[alternateCurrency] || 0
    : 0;
  const splitAmountValue = 0;
  const splitBasePreview = roundMoney(splitAmountValue * alternateFxRate);
  const remainderBasePreview = Math.max(0, roundMoney(saleTotal - splitBasePreview));
  const primaryAmountPreview = paymentCurrency === baseCurrency
    ? remainderBasePreview
    : roundMoney(remainderBasePreview / (paymentFxRate || 1));

  const resetPaymentForm = () => {
    setMethod("Cash");
    setPaymentCurrency(baseCurrency);
    setPaymentRate("");
  };

  const addProductToSale = (productId: string, quantity = 1) => {
    const product = products.find(p => p.id === productId);
    if (!product) return false;
    const unitPrice = parseFloat(String(product.costPrice || 0)) || 0;
    if (quantity > product.stock) {
      toast.error(`Only ${product.stock} ${product.name} in stock`);
      return false;
    }
    if (unitPrice <= 0) {
      toast.error("Set a product cost greater than zero before recording the sale.");
      return false;
    }
    const existing = lineItems.findIndex(l => l.productId === product.id);
    if (existing >= 0) {
      const newItems = [...lineItems];
      newItems[existing].quantity += quantity;
      newItems[existing].unitPrice = unitPrice;
      if (newItems[existing].quantity > product.stock) {
        toast.error(`Only ${product.stock} ${product.name} in stock`);
        return false;
      }
      setLineItems(newItems);
    } else {
      setLineItems([...lineItems, { productId: product.id, productName: product.name, quantity, unitPrice }]);
    }
    return true;
  };

  const addLineItem = () => {
    const quantity = parseInt(qty, 10) || 1;
    if (!addProductToSale(selectedProduct, quantity)) return;
    setSelectedProduct("");
    setQty("1");
  };

  const handleBarcodeLookup = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    const quantity = parseInt(qty, 10) || 1;

    const matchedProduct = products.find((product) => product.barcode?.trim() === code);
    if (!matchedProduct) {
      toast.error(`No product found for barcode ${code}`);
      return;
    }

    if (!addProductToSale(matchedProduct.id, quantity)) return;

    setSelectedProduct(matchedProduct.id);
    setBarcodeInput("");
    toast.success(`${quantity} ${matchedProduct.name} added to this sale`);
  };

  const handleBarcodeDetected = (code: string) => {
    handleBarcodeLookup(code);
    setScanOpen(false);
  };

  const removeLineItem = (idx: number) => setLineItems(lineItems.filter((_, i) => i !== idx));

  const paymentAllocations = useMemo(() => {
    const rows: Array<{ currency: string; amount: number; fx_rate_to_base?: number }> = [];
    if (SHOW_SPLIT_PAYMENT && alternateCurrency && splitAmountValue > 0) {
      rows.push({
        currency: alternateCurrency,
        amount: splitAmountValue,
        fx_rate_to_base: alternateCurrency === baseCurrency ? undefined : alternateFxRate,
      });
    }
    if (saleTotal > 0) {
      rows.push({
        currency: paymentCurrency,
        amount: primaryAmountPreview,
        fx_rate_to_base: paymentCurrency === baseCurrency ? undefined : paymentFxRate,
      });
    }
    return rows.filter((row) => row.amount > 0);
  }, [alternateCurrency, splitAmountValue, alternateFxRate, baseCurrency, saleTotal, paymentCurrency, primaryAmountPreview, paymentFxRate]);

  const createOfflineSale = () => {
    addSale({
      items: lineItems.map((l) => `${l.quantity} ${l.productName}`).join(", "),
      total: saleTotal,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      date: "Today",
      method,
      paymentCurrency,
      paymentAllocations: paymentAllocations.map((row) => ({
        currency: row.currency,
        amount: row.amount,
        amountBase: roundMoney(row.amount * (row.fx_rate_to_base || 1)),
      })),
      saleItems: lineItems,
    });
  };

  const handleAdd = async () => {
    if (lineItems.length === 0) return;
    if (saleTotal <= 0) {
      toast.error("Add at least one item with a product cost greater than zero.");
      return;
    }

    if (paymentCurrency !== baseCurrency && paymentFxRate <= 0) {
      toast.error(`Enter a valid rate for ${paymentCurrency}.`);
      return;
    }
    if (SHOW_SPLIT_PAYMENT && splitAmountValue > 0 && alternateCurrency && alternateFxRate <= 0) {
      toast.error(`Enter a valid rate for ${alternateCurrency}.`);
      return;
    }
    if (splitBasePreview > saleTotal) {
      toast.error("Split payment is bigger than the sale total.");
      return;
    }

    setSaving(true);

    const apiPayload = {
      payment_method: method,
      payment_currency: paymentCurrency,
      // Multi-branch is disabled for now. Keep sending null until branch routing is restored.
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
      payment_currency: paymentCurrency,
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

    if (SHOW_SPLIT_PAYMENT && paymentAllocations.length > 0) {
      Object.assign(apiPayload, { payment_allocations: paymentAllocations });
      Object.assign(offlinePayload, {
        payment_allocations: paymentAllocations.map((row) => ({
          currency: row.currency,
          amount: row.amount.toFixed(2),
          fx_rate_to_base: row.fx_rate_to_base,
        })),
      });
    }

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
      setBarcodeInput("");
      setSelectedProduct("");
      setQty("1");
      resetPaymentForm();
      setAddOpen(false);
      setSaving(false);
      return;
    }

    try {
      await createSaleApi(apiPayload);
      toast.success("Sale recorded");
      setLineItems([]);
      setBarcodeInput("");
      setSelectedProduct("");
      setQty("1");
      resetPaymentForm();
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
      const allocationLines = (receipt.payment_allocations || []).map((row) => {
        const amount = Number(row.amount || 0);
        const baseAmount = Number(row.amount_base || 0);
        const rowSymbol = symbolForCurrency(row.currency);
        return `${row.currency}: ${rowSymbol}${amount.toLocaleString()}${row.currency !== baseCurrency ? ` (${sym}${baseAmount.toLocaleString()} base)` : ""}`;
      });
      const lines = [
        receipt.business_name || "Verifin Receipt",
        // Multi-branch is disabled for now. Keep this line commented for later reactivation.
        // receipt.branch ? `Branch: ${receipt.branch}` : "",
        `Receipt: ${receipt.receipt_number}`,
        receipt.invoice_number ? `Invoice: ${receipt.invoice_number}` : "",
        `${receipt.date} ${receipt.time}`,
        `Payment: ${receipt.payment_method}`,
        receipt.payment_currency ? `Currency: ${receipt.payment_currency}` : "",
        allocationLines.length ? "" : "",
        ...allocationLines,
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

      {SHOW_TILL_CONTROLS && (
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
      )}

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
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{s.time} · {s.date} · {s.method}</span>
                      {s.paymentCurrency ? <span className="rounded border border-border px-2 py-0.5">{s.paymentCurrency}</span> : null}
                    </div>
                    {s.paymentAllocations?.length && s.paymentAllocations.length > 1 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Split: {s.paymentAllocations.map((row) => `${symbolForCurrency(row.currency)}${row.amount.toLocaleString()} ${row.currency}`).join(" + ")}
                      </p>
                    ) : null}
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
          <DialogHeader>
            <DialogTitle className="font-display">Record Sale</DialogTitle>
            <DialogDescription>
              Add products, choose payment currency, and save the sale total in your base currency.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Barcode</Label>
              <div className="flex gap-2">
                <Input
                  ref={barcodeInputRef}
                  value={barcodeInput}
                  onChange={e => setBarcodeInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleBarcodeLookup(barcodeInput);
                    }
                  }}
                  placeholder="Scan or type barcode, then press Enter"
                />
                {canUseCameraScan ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (!canUse("barcode_scanning")) {
                        promptUpgrade("barcode_scanning", "Barcode scanning");
                        return;
                      }
                      setScanOpen(true);
                    }}
                  >
                    <ScanBarcode className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Scan a saved barcode to add that product straight into the sale.
              </p>
            </div>

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
                Add
              </Button>
            </div>

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

            <div>
              <Label>Payment Currency</Label>
              <select
                value={paymentCurrency}
                onChange={e => {
                  setPaymentCurrency(e.target.value);
                  setPaymentRate("");
                }}
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {enabledCurrencies.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>

            {paymentCurrency !== baseCurrency ? (
              <div>
                <Label>Rate to {baseCurrency}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.000001"
                  placeholder={`1 ${paymentCurrency} = ? ${baseCurrency}`}
                  value={paymentRate || String(profile.exchangeRates?.[paymentCurrency] ?? "")}
                  onChange={e => setPaymentRate(e.target.value)}
                  className="mt-1"
                />
              </div>
            ) : null}

            {SHOW_SPLIT_PAYMENT && alternateCurrency ? (
              <div className="rounded-md border border-border p-3 space-y-3">
                <div>
                  <p className="text-sm font-medium">Split Payment</p>
                  <p className="text-xs text-muted-foreground">Optional. Record part of this sale in {alternateCurrency}.</p>
                </div>
                <div>
                  <Label>Amount in {alternateCurrency}</Label>
                  <Input type="number" placeholder="0.00" value="" readOnly className="mt-1" />
                </div>
                {alternateCurrency !== baseCurrency ? (
                  <div>
                    <Label>Rate for {alternateCurrency}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.000001"
                      placeholder={`1 ${alternateCurrency} = ? ${baseCurrency}`}
                      value={String(profile.exchangeRates?.[alternateCurrency] ?? "")}
                      readOnly
                      className="mt-1"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm space-y-1">
              <p>Sale total in {baseCurrency}: {sym}{saleTotal.toLocaleString()}</p>
              {splitAmountValue > 0 && alternateCurrency ? <p>Split in {alternateCurrency}: {symbolForCurrency(alternateCurrency)}{splitAmountValue.toLocaleString()} ({sym}{splitBasePreview.toLocaleString()} base)</p> : null}
              {saleTotal > 0 ? <p>Remaining in {paymentCurrency}: {symbolForCurrency(paymentCurrency)}{primaryAmountPreview.toLocaleString()}</p> : null}
            </div>

            <Button onClick={handleAdd} disabled={lineItems.length === 0 || saving} className="w-full bg-gradient-hero text-primary-foreground">
              {saving ? "Saving..." : `Record Sale - ${sym}${saleTotal.toLocaleString()}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleBarcodeDetected} />
      {SHOW_TILL_CONTROLS && (
        <Dialog open={tillOpen} onOpenChange={setTillOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">{till ? "Close Till" : "Open Till"}</DialogTitle>
              <DialogDescription>
                {till ? "Capture the counted cash to close this till session." : "Start a till session for this cashier."}
              </DialogDescription>
            </DialogHeader>
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
      )}
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Receipt</DialogTitle>
            <DialogDescription>
              Review the generated receipt text and copy it if you need to share it.
            </DialogDescription>
          </DialogHeader>
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
