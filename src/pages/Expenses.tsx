import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Camera, Plus, Search, Trash2, Receipt, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { createExpenseApi, deleteExpenseApi, scanReceiptApi } from "@/lib/api";
import { addToOfflineQueue, canQueueOfflineAction } from "@/lib/offlineQueue";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { symbolForCurrency } from "@/lib/currency";
import { displayBusinessDate, isSameBusinessDay } from "@/lib/reporting";
import { useFeatureAccess, useUpgradePrompt } from "@/lib/features";

const expenseCategories = ["Transport", "Utilities", "Stock Purchase", "Communication", "Rent", "Salary", "Other"];

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const Expenses = () => {
  const { expenses, deleteExpense, profile, addExpense, upsertExpense } = useStore();
  const { canUse } = useFeatureAccess();
  const promptUpgrade = useUpgradePrompt();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [form, setForm] = useState({
    desc: "",
    amount: "",
    category: "Transport",
    currency: profile.currency,
    fxRate: "",
    date: todayIso(),
  });

  const baseCurrency = profile.currency || "ZAR";
  const baseSymbol = profile.currencySymbol || symbolForCurrency(baseCurrency);
  const enabledCurrencies = profile.enabledCurrencies?.length ? profile.enabledCurrencies : [baseCurrency];
  const selectedCurrency = form.currency || baseCurrency;
  const selectedRate = selectedCurrency === baseCurrency
    ? 1
    : parseFloat(form.fxRate) || profile.exchangeRates?.[selectedCurrency] || 0;
  const enteredAmount = parseFloat(form.amount) || 0;
  const amountBasePreview = roundMoney(enteredAmount * selectedRate);
  const categoryOptions = useMemo(() => Array.from(new Set([...expenseCategories, form.category || "Other"])), [form.category]);

  const filtered = expenses.filter(e => e.desc.toLowerCase().includes(search.toLowerCase()));
  const selectedExpense = expenses.find((expense) => expense.id === selectedExpenseId) || null;
  const monthTotal = useMemo(() => expenses.reduce((sum, e) => sum + (e.amountBase ?? e.amount), 0), [expenses]);
  const todayTotal = useMemo(
    () => expenses.filter(e => isSameBusinessDay(e.date)).reduce((sum, e) => sum + (e.amountBase ?? e.amount), 0),
    [expenses]
  );

  const resetForm = () => {
    setForm({
      desc: "",
      amount: "",
      category: "Transport",
      currency: baseCurrency,
      fxRate: "",
      date: todayIso(),
    });
    setReceiptFile(null);
    setReceiptDataUrl(null);
  };

  useEffect(() => {
    if (!receiptFile) {
      setReceiptPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(receiptFile);
    setReceiptPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [receiptFile]);

  const readFileDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Could not read receipt image"));
      reader.readAsDataURL(file);
    });

  const handleScanFile = async (file: File | null) => {
    if (!file) return;
    if (!navigator.onLine) {
      toast.error("Receipt scanning needs internet. You can still add the expense manually.");
      return;
    }
    setScanning(true);
    try {
      const dataUrl = await readFileDataUrl(file);
      const result = await scanReceiptApi({ receipt: file });
      const parsed = result.parsed || {};
      const parsedAmount = typeof parsed.amount === "number" && Number.isFinite(parsed.amount) && parsed.amount > 0
        ? String(parsed.amount)
        : "";
      setReceiptFile(file);
      setForm((prev) => ({
        ...prev,
        desc: parsed.merchant && parsed.merchant !== "Unknown merchant" ? parsed.merchant : prev.desc,
        amount: parsedAmount || prev.amount,
        category: parsed.category || prev.category,
        date: parsed.date || prev.date || todayIso(),
      }));
      setReceiptDataUrl(dataUrl);
      setScanOpen(false);
      setAddOpen(true);
      toast.success(result.message || "Receipt scanned. Review the expense before saving.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not scan receipt");
    } finally {
      setScanning(false);
    }
  };

  const handleAdd = async () => {
    const amount = parseFloat(form.amount) || 0;
    const currency = form.currency || baseCurrency;
    const fxRate = currency === baseCurrency ? 1 : parseFloat(form.fxRate) || profile.exchangeRates?.[currency] || 0;
    const amountBase = roundMoney(amount * fxRate);

    if (amount <= 0) {
      toast.error("Enter an expense amount greater than zero.");
      return;
    }

    if (currency !== baseCurrency && fxRate <= 0) {
      toast.error(`Enter a valid rate for ${currency}.`);
      return;
    }

    setSaving(true);

    const payload = {
      description: form.desc,
      amount,
      currency,
      fx_rate_to_base: currency === baseCurrency ? undefined : fxRate,
      categoryName: form.category,
      date: form.date || todayIso(),
    };

    const saveOffline = () => {
      addExpense({
        desc: form.desc,
        amount,
        currency,
        amountBase,
        category: form.category,
        date: payload.date,
        receiptImage: receiptDataUrl || undefined,
        receiptFileName: receiptFile?.name,
      });
      addToOfflineQueue({ type: "expense", payload });
      toast.success("Expense saved locally while offline. It will sync when you are back online.");
      resetForm();
      setAddOpen(false);
    };

    if (!navigator.onLine && !canQueueOfflineAction()) {
      toast.error("Offline mode is available after you have signed in on this device.");
      setSaving(false);
      return;
    }

    if (canQueueOfflineAction()) {
      saveOffline();
      setSaving(false);
      return;
    }

    try {
      const created = await createExpenseApi(payload);
      upsertExpense({
        id: String(created.id),
        desc: created.description,
        amount: parseFloat(created.amount),
        currency: created.currency || currency,
        amountBase: parseFloat(created.amount_base || created.amount || "0"),
        paymentAllocations: (created.payment_allocations || []).map((row) => ({
          currency: row.currency,
          amount: parseFloat(row.amount),
          amountBase: parseFloat(row.amount_base || "0"),
        })),
        category: created.category_name || form.category,
        date: created.date || payload.date,
        receiptImage: created.receipt_image || receiptDataUrl || undefined,
        receiptFileName: receiptFile?.name,
      });
      resetForm();
      setAddOpen(false);
      toast.success("Expense recorded");
    } catch (e) {
      if (canQueueOfflineAction()) {
        saveOffline();
      } else {
        toast.error(e instanceof Error ? e.message : "Could not record expense");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <Card className="shadow-soft"><CardContent className="p-4"><p className="text-xs text-muted-foreground">This Month</p><p className="text-xl font-display font-bold mt-1">{baseSymbol}{monthTotal.toLocaleString()}</p></CardContent></Card>
        <Card className="shadow-soft"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Today</p><p className="text-xl font-display font-bold mt-1">{baseSymbol}{todayTotal.toLocaleString()}</p></CardContent></Card>
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search expenses..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            if (!canUse("receipt_ocr")) {
              promptUpgrade("receipt_ocr", "Receipt OCR");
              return;
            }
            setScanOpen(true);
          }}
        >
          <Camera className="h-4 w-4 mr-2" /> Scan Receipt
        </Button>
        <Button onClick={() => setAddOpen(true)} className="bg-gradient-accent text-accent-foreground"><Plus className="h-4 w-4 mr-2" /> Add Expense</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Receipt} title="No expenses recorded" description="Start tracking your expenses" actionLabel="Add Expense" onAction={() => setAddOpen(true)} />
      ) : (
        <Card className="shadow-soft">
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {filtered.map((e, i) => {
                const itemSymbol = symbolForCurrency(e.currency || baseCurrency);
                const baseAmount = e.amountBase ?? e.amount;
                const usesAltCurrency = (e.currency || baseCurrency) !== baseCurrency;

                return (
                  <motion.div
                    key={e.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedExpenseId(e.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedExpenseId(e.id);
                      }
                    }}
                    className="flex cursor-pointer items-center justify-between p-4 hover:bg-muted/30 transition-colors group"
                  >
                    <div>
                      <p className="font-medium text-sm">{e.desc}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground">{displayBusinessDate(e.date)}</span>
                        <Badge variant="secondary" className="text-xs">{e.category}</Badge>
                        <Badge variant="outline" className="text-xs">{e.currency || baseCurrency}</Badge>
                        {e.receiptImage ? <Badge variant="outline" className="text-xs">Receipt</Badge> : null}
                      </div>
                      {e.paymentAllocations?.length && e.paymentAllocations.length > 1 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Split: {e.paymentAllocations.map((row) => `${symbolForCurrency(row.currency)}${row.amount.toLocaleString()} ${row.currency}`).join(" + ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="font-display font-bold text-destructive">-{itemSymbol}{e.amount.toLocaleString()}</p>
                        {usesAltCurrency ? (
                          <p className="text-xs text-muted-foreground">Base {baseSymbol}{baseAmount.toLocaleString()}</p>
                        ) : null}
                      </div>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteId(e.id);
                        }}
                        className="p-1.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Add Expense</DialogTitle>
            <DialogDescription>Record an operating expense and optionally convert it into your base reporting currency.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {receiptFile && (
              <div className="flex gap-3 rounded-md border border-border bg-muted/30 p-3">
                {receiptPreviewUrl ? (
                  <img src={receiptPreviewUrl} alt="Receipt preview" className="h-20 w-20 rounded-md object-cover" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-md bg-muted">
                    <Receipt className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{receiptFile.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Review the extracted fields before saving this expense.</p>
                  <Button type="button" variant="ghost" size="sm" className="mt-2 h-8 px-2" onClick={() => setReceiptFile(null)}>
                    Remove receipt
                  </Button>
                </div>
              </div>
            )}
            <div><Label>Description</Label><Input placeholder="e.g. Supplier delivery" value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} className="mt-1" /></div>
            <div>
              <Label>Currency</Label>
              <select
                value={form.currency}
                onChange={e => setForm({ ...form, currency: e.target.value, fxRate: "" })}
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {enabledCurrencies.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
            <div><Label>Amount ({symbolForCurrency(selectedCurrency)})</Label><Input type="number" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="mt-1" /></div>
            <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="mt-1" /></div>
            {selectedCurrency !== baseCurrency ? (
              <div>
                <Label>Exchange Rate ({selectedCurrency} to {baseCurrency})</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.000001"
                  placeholder={`1 ${selectedCurrency} = ? ${baseCurrency}`}
                  value={form.fxRate || String(profile.exchangeRates?.[selectedCurrency] ?? "")}
                  onChange={e => setForm({ ...form, fxRate: e.target.value })}
                  className="mt-1"
                />
              </div>
            ) : null}
            <div>
              <Label>Category</Label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm space-y-1">
              <p>Total in {baseCurrency}: {baseSymbol}{amountBasePreview.toLocaleString()}</p>
              {selectedCurrency !== baseCurrency ? (
                <p>Using 1 {selectedCurrency} = {selectedRate.toLocaleString(undefined, { maximumFractionDigits: 6 })} {baseCurrency}</p>
              ) : null}
            </div>

            <Button onClick={handleAdd} disabled={!form.desc.trim() || !form.amount || saving} className="w-full bg-gradient-accent text-accent-foreground">{saving ? "Saving..." : "Add Expense"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Scan Receipt</DialogTitle>
            <DialogDescription>Upload or take a receipt photo, then review the extracted expense details before saving.</DialogDescription>
          </DialogHeader>
          <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-colors hover:bg-muted/50">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="mt-3 text-sm font-medium">{scanning ? "Scanning receipt..." : "Choose receipt photo"}</span>
            <span className="mt-1 text-xs text-muted-foreground">Camera opens on supported mobile browsers.</span>
            <Input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={scanning}
              className="sr-only"
              onChange={(e) => {
                void handleScanFile(e.target.files?.[0] || null);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </DialogContent>
      </Dialog>
      <Dialog open={!!selectedExpense} onOpenChange={(open) => !open && setSelectedExpenseId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Expense Details</DialogTitle>
            <DialogDescription>Review the saved expense and receipt image.</DialogDescription>
          </DialogHeader>
          {selectedExpense && (
            <div className="space-y-4">
              {selectedExpense.receiptImage ? (
                <img
                  src={selectedExpense.receiptImage}
                  alt={selectedExpense.receiptFileName || "Receipt"}
                  className="max-h-72 w-full rounded-md border border-border object-contain bg-muted/30"
                />
              ) : (
                <div className="flex h-40 flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-muted-foreground">
                  <Receipt className="h-8 w-8" />
                  <p className="mt-2 text-sm">No receipt image saved</p>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="mt-1 font-medium">{selectedExpense.desc}</p>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <p className="mt-1 font-medium">{symbolForCurrency(selectedExpense.currency || baseCurrency)}{selectedExpense.amount.toLocaleString()} {selectedExpense.currency || baseCurrency}</p>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="mt-1 font-medium">{displayBusinessDate(selectedExpense.date)}</p>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Category</p>
                  <p className="mt-1 font-medium">{selectedExpense.category}</p>
                </div>
              </div>
              {selectedExpense.amountBase != null && (selectedExpense.currency || baseCurrency) !== baseCurrency ? (
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Base Amount</p>
                  <p className="mt-1 font-medium">{baseSymbol}{selectedExpense.amountBase.toLocaleString()} {baseCurrency}</p>
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmationModal
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Delete Expense"
        description="Remove this expense record?"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!deleteId) return;
          try {
            await deleteExpenseApi(deleteId);
            deleteExpense(deleteId);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not delete");
          }
          setDeleteId(null);
        }}
      />
    </div>
  );
};

export default Expenses;
