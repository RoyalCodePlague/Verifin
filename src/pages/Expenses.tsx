import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, Trash2, Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { createExpenseApi, deleteExpenseApi } from "@/lib/api";
import { addToOfflineQueue, canQueueOfflineAction } from "@/lib/offlineQueue";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { symbolForCurrency } from "@/lib/currency";

const expenseCategories = ["Transport", "Utilities", "Stock Purchase", "Communication", "Rent", "Salary", "Other"];

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

const Expenses = () => {
  const { expenses, deleteExpense, profile, addExpense, upsertExpense } = useStore();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    desc: "",
    amount: "",
    category: "Transport",
    currency: profile.currency,
    fxRate: "",
    splitAmount: "",
    splitRate: "",
  });

  const baseCurrency = profile.currency || "ZAR";
  const baseSymbol = profile.currencySymbol || symbolForCurrency(baseCurrency);
  const enabledCurrencies = profile.enabledCurrencies?.length ? profile.enabledCurrencies : [baseCurrency];
  const secondaryCurrency = enabledCurrencies.find((code) => code !== baseCurrency) || "";
  const selectedCurrency = form.currency || baseCurrency;
  const alternateCurrency = selectedCurrency === baseCurrency ? secondaryCurrency : baseCurrency;
  const selectedRate = selectedCurrency === baseCurrency
    ? 1
    : parseFloat(form.fxRate) || profile.exchangeRates?.[selectedCurrency] || 0;
  const alternateRate = alternateCurrency
    ? alternateCurrency === baseCurrency
      ? 1
      : parseFloat(form.splitRate) || profile.exchangeRates?.[alternateCurrency] || 0
    : 0;
  const enteredAmount = parseFloat(form.amount) || 0;
  const splitAmount = parseFloat(form.splitAmount) || 0;
  const amountBasePreview = roundMoney(enteredAmount * selectedRate);
  const splitBasePreview = alternateCurrency ? roundMoney(splitAmount * alternateRate) : 0;
  const remainderBasePreview = Math.max(0, roundMoney(amountBasePreview - splitBasePreview));

  const filtered = expenses.filter(e => e.desc.toLowerCase().includes(search.toLowerCase()));
  const monthTotal = useMemo(() => expenses.reduce((sum, e) => sum + (e.amountBase ?? e.amount), 0), [expenses]);
  const todayTotal = useMemo(
    () => expenses.filter(e => e.date === "Today").reduce((sum, e) => sum + (e.amountBase ?? e.amount), 0),
    [expenses]
  );

  const resetForm = () => {
    setForm({
      desc: "",
      amount: "",
      category: "Transport",
      currency: baseCurrency,
      fxRate: "",
      splitAmount: "",
      splitRate: "",
    });
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

    let paymentAllocations: Array<{ currency: string; amount: number; fx_rate_to_base?: number }> | undefined;

    if (alternateCurrency && splitAmount > 0) {
      if (alternateRate <= 0) {
        toast.error(`Enter a valid rate for ${alternateCurrency}.`);
        return;
      }
      const splitBase = roundMoney(splitAmount * alternateRate);
      if (splitBase > amountBase) {
        toast.error("Split payment is bigger than the expense total.");
        return;
      }

      const rows: Array<{ currency: string; amount: number; fx_rate_to_base?: number }> = [
        {
          currency: alternateCurrency,
          amount: splitAmount,
          fx_rate_to_base: alternateCurrency === baseCurrency ? undefined : alternateRate,
        },
      ];

      const remainderBase = roundMoney(amountBase - splitBase);
      if (remainderBase > 0) {
        const remainderAmount = roundMoney(remainderBase / fxRate);
        rows.push({
          currency,
          amount: remainderAmount,
          fx_rate_to_base: currency === baseCurrency ? undefined : fxRate,
        });
      }

      paymentAllocations = rows;
    }

    setSaving(true);

    const payload = {
      description: form.desc,
      amount,
      currency,
      fx_rate_to_base: currency === baseCurrency ? undefined : fxRate,
      payment_allocations: paymentAllocations,
      categoryName: form.category,
      date: new Date().toISOString().slice(0, 10),
    };

    const saveOffline = () => {
      addExpense({
        desc: form.desc,
        amount,
        currency,
        amountBase,
        paymentAllocations: paymentAllocations?.map((row) => ({
          currency: row.currency,
          amount: row.amount,
          amountBase: roundMoney(row.amount * (row.fx_rate_to_base || 1)),
        })),
        category: form.category,
        date: "Today",
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
        date: created.date === payload.date ? "Today" : created.date,
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
                  <motion.div key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors group">
                    <div>
                      <p className="font-medium text-sm">{e.desc}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground">{e.date}</span>
                        <Badge variant="secondary" className="text-xs">{e.category}</Badge>
                        <Badge variant="outline" className="text-xs">{e.currency || baseCurrency}</Badge>
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
                      <button onClick={() => setDeleteId(e.id)} className="p-1.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
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
          <DialogHeader><DialogTitle className="font-display">Add Expense</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Description</Label><Input placeholder="e.g. Supplier delivery" value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} className="mt-1" /></div>
            <div>
              <Label>Currency</Label>
              <select
                value={form.currency}
                onChange={e => setForm({ ...form, currency: e.target.value, fxRate: "", splitAmount: "", splitRate: "" })}
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {enabledCurrencies.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
            <div><Label>Amount ({symbolForCurrency(selectedCurrency)})</Label><Input type="number" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="mt-1" /></div>
            {selectedCurrency !== baseCurrency ? (
              <div>
                <Label>Rate to {baseCurrency}</Label>
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
                {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {alternateCurrency ? (
              <div className="rounded-md border border-border p-3 space-y-3">
                <div>
                  <p className="text-sm font-medium">Split Payment</p>
                  <p className="text-xs text-muted-foreground">Optional. Record part of this expense in {alternateCurrency}.</p>
                </div>
                <div>
                  <Label>Amount in {alternateCurrency}</Label>
                  <Input type="number" placeholder="0.00" value={form.splitAmount} onChange={e => setForm({ ...form, splitAmount: e.target.value })} className="mt-1" />
                </div>
                {alternateCurrency !== baseCurrency ? (
                  <div>
                    <Label>Rate for {alternateCurrency}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.000001"
                      placeholder={`1 ${alternateCurrency} = ? ${baseCurrency}`}
                      value={form.splitRate || String(profile.exchangeRates?.[alternateCurrency] ?? "")}
                      onChange={e => setForm({ ...form, splitRate: e.target.value })}
                      className="mt-1"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm space-y-1">
              <p>Total in {baseCurrency}: {baseSymbol}{amountBasePreview.toLocaleString()}</p>
              {splitAmount > 0 && alternateCurrency ? <p>Split in {alternateCurrency}: {symbolForCurrency(alternateCurrency)}{splitAmount.toLocaleString()} ({baseSymbol}{splitBasePreview.toLocaleString()} base)</p> : null}
              {splitAmount > 0 ? <p>Remaining in {selectedCurrency}: {symbolForCurrency(selectedCurrency)}{roundMoney(remainderBasePreview / (selectedRate || 1)).toLocaleString()}</p> : null}
            </div>

            <Button onClick={handleAdd} disabled={!form.desc.trim() || !form.amount || saving} className="w-full bg-gradient-accent text-accent-foreground">{saving ? "Saving..." : "Add Expense"}</Button>
          </div>
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
