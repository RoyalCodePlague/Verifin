import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, Trash2, Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { createExpenseApi, deleteExpenseApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { addToOfflineQueue, canQueueOfflineAction } from "@/lib/offlineQueue";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";

const expenseCategories = ["Transport", "Utilities", "Stock Purchase", "Communication", "Rent", "Salary", "Other"];

const Expenses = () => {
  const { expenses, deleteExpense, profile, addExpense } = useStore();
  const { refreshUser } = useAuth();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ desc: "", amount: "", category: "Transport" });
  const sym = profile.currencySymbol || "R";

  const filtered = expenses.filter(e => e.desc.toLowerCase().includes(search.toLowerCase()));
  const monthTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const todayTotal = expenses.filter(e => e.date === "Today").reduce((sum, e) => sum + e.amount, 0);

  const handleAdd = async () => {
    setSaving(true);

    const payload = {
      description: form.desc,
      amount: parseFloat(form.amount) || 0,
      categoryName: form.category,
      date: new Date().toISOString().slice(0, 10),
    };

    const saveOffline = () => {
      addExpense({
        desc: form.desc,
        amount: parseFloat(form.amount) || 0,
        category: form.category,
        date: "Today",
      });
      addToOfflineQueue({ type: "expense", payload });
      toast.success("Expense saved locally while offline. It will sync when you are back online.");
      setForm({ desc: "", amount: "", category: "Transport" });
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
      await createExpenseApi(payload);
      setForm({ desc: "", amount: "", category: "Transport" });
      setAddOpen(false);
      toast.success("Expense recorded");
      await refreshUser();
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
        <Card className="shadow-soft"><CardContent className="p-4"><p className="text-xs text-muted-foreground">This Month</p><p className="text-xl font-display font-bold mt-1">{sym}{monthTotal.toLocaleString()}</p></CardContent></Card>
        <Card className="shadow-soft"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Today</p><p className="text-xl font-display font-bold mt-1">{sym}{todayTotal.toLocaleString()}</p></CardContent></Card>
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
              {filtered.map((e, i) => (
                <motion.div key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors group">
                  <div>
                    <p className="font-medium text-sm">{e.desc}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{e.date}</span>
                      <Badge variant="secondary" className="text-xs">{e.category}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="font-display font-bold text-destructive">-{sym}{e.amount.toLocaleString()}</p>
                    <button onClick={() => setDeleteId(e.id)} className="p-1.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display">Add Expense</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Description</Label><Input placeholder="e.g. Transport — Supplier delivery" value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} className="mt-1" /></div>
            <div><Label>Amount ({sym})</Label><Input type="number" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="mt-1" /></div>
            <div>
              <Label>Category</Label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <Button onClick={handleAdd} disabled={!form.desc.trim() || !form.amount || saving} className="w-full bg-gradient-accent text-accent-foreground">{saving ? "Saving…" : "Add Expense"}</Button>
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
            await refreshUser();
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
