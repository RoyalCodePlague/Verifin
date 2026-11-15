import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Camera, CalendarClock, Check, Pause, Play, Plus, RefreshCw, Search, Trash2, Receipt, Upload, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import {
  type ApiExpenseBudget,
  type ApiExpenseAnalysis,
  type ApiFinancialAccount,
  type ApiRecurringExpense,
  approveExpenseApi,
  createExpenseApi,
  createExpenseWithReceiptApi,
  createExpenseBudgetApi,
  createRecurringExpenseApi,
  deleteExpenseApi,
  deleteExpenseBudgetApi,
  ensureExpenseCategoryId,
  getExpenseAnalysisApi,
  generateRecurringExpensesApi,
  listExpenseBudgetsApi,
  listFinancialAccountsApi,
  listRecurringExpensesApi,
  rejectExpenseApi,
  scanReceiptApi,
  updateRecurringExpenseApi,
} from "@/lib/api";
import { addToOfflineQueue, canQueueOfflineAction } from "@/lib/offlineQueue";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { symbolForCurrency } from "@/lib/currency";
import { displayBusinessDate, isSameBusinessDay, parseBusinessDate } from "@/lib/reporting";
import { useFeatureAccess, useUpgradePrompt } from "@/lib/features";
import { useAuth } from "@/lib/auth-context";

const expenseCategories = ["Transport", "Utilities", "Stock Purchase", "Communication", "Rent", "Salary", "Other"];

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function monthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { start: iso(first), end: iso(last) };
}

const Expenses = () => {
  const { expenses, branches, deleteExpense, profile, addExpense, upsertExpense } = useStore();
  const { isStaffSession, staffSession } = useAuth();
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
  const [budgets, setBudgets] = useState<ApiExpenseBudget[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<ApiRecurringExpense[]>([]);
  const [financialAccounts, setFinancialAccounts] = useState<ApiFinancialAccount[]>([]);
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [planningLoading, setPlanningLoading] = useState(true);
  const [planningSaving, setPlanningSaving] = useState(false);
  const [planningError, setPlanningError] = useState("");
  const [expenseAnalysis, setExpenseAnalysis] = useState<ApiExpenseAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [budgetForm, setBudgetForm] = useState(() => ({
    categoryName: "",
    subcategoryName: "",
    branchId: "",
    expenseType: "operating" as ApiExpenseBudget["expense_type"],
    ...monthRange(),
    amount: "",
    note: "",
  }));
  const [recurringForm, setRecurringForm] = useState({
    description: "",
    amount: "",
    expenseType: "operating" as "operating" | "other",
    currency: profile.currency,
    fxRate: "",
    categoryName: "",
    subcategoryName: "",
    branchId: "",
    frequency: "monthly" as ApiRecurringExpense["frequency"],
    firstDueDate: todayIso(),
    endDate: "",
    accountId: "",
  });
  const [form, setForm] = useState({
    desc: "",
    amount: "",
    expenseType: "operating" as "operating" | "other",
    category: "Transport",
    subcategory: "",
    currency: profile.currency,
    fxRate: "",
    date: todayIso(),
    branchId: branches.length === 1 ? branches[0].id : "",
  });

  const baseCurrency = profile.currency || "ZAR";
  const baseSymbol = profile.currencySymbol || symbolForCurrency(baseCurrency);
  const enabledCurrencies = profile.enabledCurrencies?.length ? profile.enabledCurrencies : [baseCurrency];
  const selectedCurrency = form.currency || baseCurrency;
  const selectedRate = selectedCurrency === baseCurrency
    ? 1
    : parseFloat(form.fxRate) || profile.exchangeRates?.[selectedCurrency] || 0;
  const eligibleExpenseAccounts = financialAccounts.filter((account) => account.is_active
    && account.currency.toUpperCase() === selectedCurrency.toUpperCase()
    && account.opening_date <= (form.date || todayIso()));
  const eligibleRecurringAccounts = financialAccounts.filter((account) => account.is_active
    && account.currency.toUpperCase() === recurringForm.currency.toUpperCase()
    && account.opening_date <= recurringForm.firstDueDate);
  const enteredAmount = parseFloat(form.amount) || 0;
  const amountBasePreview = roundMoney(enteredAmount * selectedRate);
  const categoryOptions = useMemo(() => Array.from(new Set([...expenseCategories, form.category || "Other"])), [form.category]);

  const filtered = expenses.filter(e => e.desc.toLowerCase().includes(search.toLowerCase()));
  const selectedExpense = expenses.find((expense) => expense.id === selectedExpenseId) || null;
  const approvedExpenses = expenses.filter((expense) => (expense.approvalStatus || "approved") === "approved");
  const currentMonth = new Date();
  const monthTotal = approvedExpenses
    .filter((expense) => {
      const date = parseBusinessDate(expense.date);
      return !!date && date.getFullYear() === currentMonth.getFullYear() && date.getMonth() === currentMonth.getMonth();
    })
    .reduce((sum, expense) => sum + (expense.amountBase ?? expense.amount), 0);
  const todayTotal = useMemo(
    () => approvedExpenses.filter(e => isSameBusinessDay(e.date)).reduce((sum, e) => sum + (e.amountBase ?? e.amount), 0),
    [approvedExpenses]
  );

  const loadPlanning = async () => {
    if (!navigator.onLine) {
      setPlanningError("Expense budgets and recurring schedules need an internet connection.");
      setPlanningLoading(false);
      return;
    }
    setPlanningLoading(true);
    setPlanningError("");
    try {
      const [budgetRows, scheduleRows] = await Promise.all([
        listExpenseBudgetsApi(),
        listRecurringExpensesApi(),
      ]);
      setBudgets(budgetRows);
      setRecurringExpenses(scheduleRows);
    } catch (error) {
      setPlanningError(error instanceof Error ? error.message : "Could not load expense planning data.");
    } finally {
      setPlanningLoading(false);
    }
  };

  useEffect(() => {
    void loadPlanning();
  }, []);

  useEffect(() => {
    listFinancialAccountsApi()
      .then((accounts) => setFinancialAccounts(accounts.filter((account) => account.is_active)))
      .catch(() => setFinancialAccounts([]));
  }, []);

  useEffect(() => {
    if (isStaffSession || !navigator.onLine) {
      setExpenseAnalysis(null);
      setAnalysisLoading(false);
      return;
    }
    let cancelled = false;
    setAnalysisLoading(true);
    setAnalysisError("");
    void getExpenseAnalysisApi()
      .then((result) => { if (!cancelled) setExpenseAnalysis(result); })
      .catch((error) => { if (!cancelled) setAnalysisError(error instanceof Error ? error.message : "Could not load expense analysis."); })
      .finally(() => { if (!cancelled) setAnalysisLoading(false); });
    return () => { cancelled = true; };
  }, [isStaffSession, expenses]);

  const saveBudget = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!navigator.onLine) {
      toast.error("Creating a budget requires internet.");
      return;
    }
    const amount = Number(budgetForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a budget amount greater than zero.");
      return;
    }
    setPlanningSaving(true);
    try {
      const parentCategory = budgetForm.categoryName.trim()
        ? await ensureExpenseCategoryId(budgetForm.categoryName)
        : null;
      const category = budgetForm.subcategoryName.trim() && parentCategory
        ? await ensureExpenseCategoryId(budgetForm.subcategoryName, parentCategory)
        : parentCategory;
      await createExpenseBudgetApi({
        ...(category ? { category } : {}),
        ...(budgetForm.branchId ? { branch: Number(budgetForm.branchId) } : {}),
        expense_type: budgetForm.expenseType,
        period_start: budgetForm.start,
        period_end: budgetForm.end,
        amount_base: amount.toFixed(2),
        note: budgetForm.note.trim(),
      });
      setBudgetForm({ categoryName: "", subcategoryName: "", branchId: "", expenseType: "operating", ...monthRange(), amount: "", note: "" });
      await loadPlanning();
      toast.success("Expense budget saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save budget.");
    } finally {
      setPlanningSaving(false);
    }
  };

  const saveRecurringExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!navigator.onLine) {
      toast.error("Recurring schedules require internet.");
      return;
    }
    const amount = Number(recurringForm.amount);
    const fxRate = recurringForm.currency === baseCurrency
      ? 1
      : Number(recurringForm.fxRate || profile.exchangeRates?.[recurringForm.currency] || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a recurring expense amount greater than zero.");
      return;
    }
    if (recurringForm.currency !== baseCurrency && (!Number.isFinite(fxRate) || fxRate <= 0)) {
      toast.error(`Enter a valid rate for ${recurringForm.currency}.`);
      return;
    }
    setPlanningSaving(true);
    try {
      const parentCategory = recurringForm.categoryName.trim()
        ? await ensureExpenseCategoryId(recurringForm.categoryName)
        : null;
      const category = recurringForm.subcategoryName.trim() && parentCategory
        ? await ensureExpenseCategoryId(recurringForm.subcategoryName, parentCategory)
        : parentCategory;
      const created = await createRecurringExpenseApi({
        description: recurringForm.description.trim(),
        amount: amount.toFixed(2),
        expense_type: recurringForm.expenseType,
        currency: recurringForm.currency,
        ...(recurringForm.currency === baseCurrency ? {} : { fx_rate_to_base: String(fxRate) }),
        ...(recurringForm.accountId && eligibleRecurringAccounts.some((account) => String(account.id) === recurringForm.accountId)
          ? { payment_allocations: [{ currency: recurringForm.currency, amount: amount.toFixed(2), ...(recurringForm.currency === baseCurrency ? {} : { fx_rate_to_base: String(fxRate) }), account: Number(recurringForm.accountId) }] }
          : {}),
        ...(category ? { category } : {}),
        ...(recurringForm.branchId ? { branch: Number(recurringForm.branchId) } : {}),
        frequency: recurringForm.frequency,
        first_due_date: recurringForm.firstDueDate,
        ...(recurringForm.endDate ? { end_date: recurringForm.endDate } : {}),
      });
      setRecurringExpenses((current) => [created, ...current.filter((row) => row.id !== created.id)]);
      setRecurringForm({
        description: "", amount: "", expenseType: "operating", currency: baseCurrency, fxRate: "",
        categoryName: "", subcategoryName: "", branchId: "", frequency: "monthly", firstDueDate: todayIso(), endDate: "", accountId: "",
      });
      toast.success("Recurring expense schedule saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save recurring schedule.");
    } finally {
      setPlanningSaving(false);
    }
  };

  const toggleRecurringExpense = async (schedule: ApiRecurringExpense) => {
    setPlanningSaving(true);
    try {
      const updated = await updateRecurringExpenseApi(schedule.id, { is_active: !schedule.is_active });
      setRecurringExpenses((current) => current.map((row) => row.id === updated.id ? updated : row));
      toast.success(updated.is_active ? "Recurring expense resumed." : "Recurring expense paused.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update schedule.");
    } finally {
      setPlanningSaving(false);
    }
  };

  const generateDueExpenses = async () => {
    if (!navigator.onLine) {
      toast.error("Generating scheduled expenses requires internet.");
      return;
    }
    setPlanningSaving(true);
    try {
      const result = await generateRecurringExpensesApi();
      for (const row of result.created) {
        upsertExpense({
          id: String(row.expense_id),
          desc: row.description,
          amount: Number(row.amount),
          currency: row.currency,
          amountBase: Number(row.amount_base),
          expenseType: row.expense_type,
          paymentAllocations: row.payment_allocations.map((allocation) => ({
            currency: allocation.currency,
            amount: Number(allocation.amount),
            amountBase: Number(allocation.amount_base),
          })),
          category: row.category_label || row.category_name || "Other",
          branchId: row.branch == null ? undefined : String(row.branch),
          date: row.date,
        });
      }
      await loadPlanning();
      toast.success(result.created_count
        ? `${result.created_count} due expense${result.created_count === 1 ? "" : "s"} generated.`
        : "No recurring expenses are due.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate due expenses.");
    } finally {
      setPlanningSaving(false);
    }
  };

  const removeBudget = async (budget: ApiExpenseBudget) => {
    setPlanningSaving(true);
    try {
      await deleteExpenseBudgetApi(budget.id);
      setBudgets((current) => current.filter((row) => row.id !== budget.id));
      toast.success("Budget removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove budget.");
    } finally {
      setPlanningSaving(false);
    }
  };

  const resetForm = () => {
    setForm({
      desc: "",
      amount: "",
      expenseType: "operating",
      category: "Transport",
      subcategory: "",
      currency: baseCurrency,
      fxRate: "",
      date: todayIso(),
      branchId: branches.length === 1 ? branches[0].id : "",
    });
    setPaymentAccountId("");
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
        subcategory: "",
        date: parsed.date || prev.date || todayIso(),
      }));
      setReceiptDataUrl(dataUrl);
      setScanOpen(false);
      setAddOpen(true);
      toast.success(result.message || "Receipt scanned. Review the expense before saving.");
    } catch (e) {
      toast.error(e instanceof Error && e.name === "AbortError"
        ? "Receipt scanning timed out. Check your connection or try a smaller image."
        : e instanceof Error ? e.message : "Could not scan receipt");
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
      ...(paymentAccountId && eligibleExpenseAccounts.some((account) => String(account.id) === paymentAccountId)
        ? { payment_allocations: [{ currency, amount, ...(currency === baseCurrency ? {} : { fx_rate_to_base: fxRate }), account: Number(paymentAccountId) }] }
        : {}),
      categoryName: form.category,
      subcategoryName: form.subcategory.trim() || undefined,
      expenseType: form.expenseType,
      expense_type: form.expenseType,
      date: form.date || todayIso(),
      branch: form.branchId ? Number(form.branchId) : undefined,
    };

    const saveOffline = () => {
      addExpense({
        desc: form.desc,
        amount,
        currency,
        amountBase,
        expenseType: form.expenseType,
        approvalStatus: isStaffSession ? "pending" : "approved",
        employeeName: staffSession?.name || undefined,
        category: form.subcategory.trim() ? `${form.category} / ${form.subcategory.trim()}` : form.category,
        branchId: form.branchId || undefined,
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
      const created = receiptFile
        ? await createExpenseWithReceiptApi(payload, receiptFile)
        : await createExpenseApi(payload);
      upsertExpense({
        id: String(created.id),
        desc: created.description,
        amount: parseFloat(created.amount),
        currency: created.currency || currency,
        amountBase: parseFloat(created.amount_base || created.amount || "0"),
        expenseType: created.expense_type || form.expenseType,
        approvalStatus: created.approval_status || "approved",
        approvalNote: created.approval_note || "",
        paymentAllocations: (created.payment_allocations || []).map((row) => ({
          currency: row.currency,
          amount: parseFloat(row.amount),
          amountBase: parseFloat(row.amount_base || "0"),
        })),
        category: created.category_label || created.category_name || (form.subcategory.trim() ? `${form.category} / ${form.subcategory.trim()}` : form.category),
        branchId: created.branch ? String(created.branch) : undefined,
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

  const reviewExpense = async (expenseId: string, decision: "approve" | "reject") => {
    try {
      const updated = decision === "approve"
        ? await approveExpenseApi(expenseId)
        : await rejectExpenseApi(expenseId);
      const expense = expenses.find((row) => row.id === expenseId);
      if (expense) {
        upsertExpense({
          ...expense,
          approvalStatus: updated.approval_status || (decision === "approve" ? "approved" : "rejected"),
          approvalNote: updated.approval_note || "",
        });
      }
      toast.success(decision === "approve" ? "Expense approved and posted." : "Expense rejected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not ${decision} expense.`);
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
                        <Badge variant="outline" className="text-xs">{e.expenseType === "other" ? "Other expense" : "Operating expense"}</Badge>
                        <Badge variant="outline" className="text-xs">{e.currency || baseCurrency}</Badge>
                        {(e.approvalStatus || "approved") !== "approved" ? (
                          <Badge variant={e.approvalStatus === "rejected" ? "destructive" : "secondary"} className="text-xs">
                            {e.approvalStatus === "rejected" ? "Rejected" : "Awaiting approval"}
                          </Badge>
                        ) : null}
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
                      {(!isStaffSession || e.approvalStatus === "pending") ? (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteId(e.id);
                          }}
                          className="p-1.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {!isStaffSession ? (
        <Card className="shadow-soft">
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold">Expense analysis</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Approved spend by category, employee, and branch.
                  {expenseAnalysis ? ` ${expenseAnalysis.start_date} to ${expenseAnalysis.end_date}.` : ""}
                </p>
              </div>
              {expenseAnalysis ? (
                <div className="text-right">
                  <p className="font-display text-lg font-bold">{baseSymbol}{Number(expenseAnalysis.total_expenses).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">
                    {expenseAnalysis.comparison.change_percent == null
                      ? "No prior-period spend"
                      : `${Number(expenseAnalysis.comparison.change_percent).toFixed(1)}% vs prior period`}
                  </p>
                </div>
              ) : null}
            </div>
            {analysisLoading ? <p className="text-sm text-muted-foreground">Loading expense analysis…</p> : null}
            {analysisError ? <p role="alert" className="text-sm text-destructive">{analysisError}</p> : null}
            {expenseAnalysis ? (
              <div className="grid gap-4 md:grid-cols-3">
                {([
                  ["Categories", expenseAnalysis.by_category, "category"],
                  ["Employees", expenseAnalysis.by_employee, "employee"],
                  ["Branches", expenseAnalysis.by_branch, "branch"],
                ] as const).map(([title, rows, labelKey]) => (
                  <div key={title} className="rounded-md border border-border p-3">
                    <h4 className="text-sm font-semibold">{title}</h4>
                    {rows.length ? (
                      <div className="mt-2 space-y-2">
                        {rows.map((row) => (
                          <div key={row[labelKey]} className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate">{row[labelKey]}</span>
                            <span className="shrink-0 font-medium">{baseSymbol}{Number(row.amount).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="mt-2 text-xs text-muted-foreground">No approved expenses in this period.</p>}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2" aria-label="Expense budgets and recurring schedules">
        <Card className="shadow-soft">
          <CardContent className="space-y-4 p-4">
            <div>
              <h3 className="font-display text-lg font-semibold">Expense budgets</h3>
              <p className="mt-1 text-sm text-muted-foreground">Track actual spending against a date range in {baseCurrency}.</p>
            </div>
            {planningError ? <p role="alert" className="text-sm text-destructive">{planningError}</p> : null}
            <form onSubmit={saveBudget} className="grid gap-3 sm:grid-cols-2">
              <div><Label>Category</Label><Input value={budgetForm.categoryName} onChange={(event) => setBudgetForm({ ...budgetForm, categoryName: event.target.value })} placeholder="Leave blank for all categories" className="mt-1" /></div>
              <div><Label>Subcategory</Label><Input value={budgetForm.subcategoryName} onChange={(event) => setBudgetForm({ ...budgetForm, subcategoryName: event.target.value })} placeholder="Optional" className="mt-1" /></div>
              <div>
                <Label>Branch</Label>
                <select value={budgetForm.branchId} onChange={(event) => setBudgetForm({ ...budgetForm, branchId: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">All branches</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Expense type</Label>
                <select value={budgetForm.expenseType} onChange={(event) => setBudgetForm({ ...budgetForm, expenseType: event.target.value as ApiExpenseBudget["expense_type"] })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="operating">Operating</option>
                  <option value="other">Other expense</option>
                  <option value="all">All expenses</option>
                </select>
              </div>
              <div><Label>Budget ({baseCurrency})</Label><Input type="number" min="0.01" step="0.01" required value={budgetForm.amount} onChange={(event) => setBudgetForm({ ...budgetForm, amount: event.target.value })} className="mt-1" /></div>
              <div><Label>Period start</Label><Input type="date" required value={budgetForm.start} onChange={(event) => setBudgetForm({ ...budgetForm, start: event.target.value })} className="mt-1" /></div>
              <div><Label>Period end</Label><Input type="date" required value={budgetForm.end} onChange={(event) => setBudgetForm({ ...budgetForm, end: event.target.value })} className="mt-1" /></div>
              <div className="sm:col-span-2"><Label>Note</Label><Input value={budgetForm.note} onChange={(event) => setBudgetForm({ ...budgetForm, note: event.target.value })} maxLength={255} placeholder="Optional context" className="mt-1" /></div>
              <Button type="submit" disabled={planningSaving || planningLoading} className="sm:col-span-2">{planningSaving ? "Saving…" : "Save budget"}</Button>
            </form>
            <div className="space-y-2 border-t border-border pt-3">
              {planningLoading ? <p className="text-sm text-muted-foreground">Loading budgets…</p> : null}
              {!planningLoading && budgets.length === 0 ? <p className="text-sm text-muted-foreground">No budgets recorded yet.</p> : null}
              {budgets.map((budget) => {
                const percent = Number(budget.percent_used) || 0;
                const overBudget = percent > 100;
                return (
                  <div key={budget.id} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{budget.category_label || budget.category_name || "All categories"} · {budget.branch_name || "All branches"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{budget.period_start} to {budget.period_end} · {budget.expense_type === "all" ? "all expenses" : budget.expense_type}</p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" disabled={planningSaving} onClick={() => void removeBudget(budget)} aria-label="Remove budget"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <div className="mt-3 flex justify-between text-sm">
                      <span>{baseSymbol}{Number(budget.spent_base).toLocaleString()} spent</span>
                      <span>{baseSymbol}{Number(budget.amount_base).toLocaleString()} budget</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded bg-muted"><div className={`h-full rounded ${overBudget ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>
                    <p className={`mt-1 text-xs ${overBudget ? "text-destructive" : "text-muted-foreground"}`}>
                      {overBudget ? `${baseSymbol}${(Number(budget.spent_base) - Number(budget.amount_base)).toLocaleString()} over budget` : `${baseSymbol}${Number(budget.remaining_base).toLocaleString()} remaining`} · {percent.toFixed(1)}%
                    </p>
                    {budget.note ? <p className="mt-1 text-xs text-muted-foreground">{budget.note}</p> : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold">Recurring expenses</h3>
                <p className="mt-1 text-sm text-muted-foreground">Schedules keep their saved exchange rate and generate each occurrence once.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void generateDueExpenses()} disabled={planningSaving || !navigator.onLine}>
                <RefreshCw className="mr-2 h-4 w-4" /> Generate due
              </Button>
            </div>
            <form onSubmit={saveRecurringExpense} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Label>Description</Label><Input required value={recurringForm.description} onChange={(event) => setRecurringForm({ ...recurringForm, description: event.target.value })} maxLength={255} placeholder="e.g. Office rent" className="mt-1" /></div>
              <div><Label>Amount ({recurringForm.currency})</Label><Input required type="number" min="0.01" step="0.01" value={recurringForm.amount} onChange={(event) => setRecurringForm({ ...recurringForm, amount: event.target.value })} className="mt-1" /></div>
              <div>
                <Label>Frequency</Label>
                <select value={recurringForm.frequency} onChange={(event) => setRecurringForm({ ...recurringForm, frequency: event.target.value as ApiRecurringExpense["frequency"] })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <Label>Currency</Label>
        <select value={recurringForm.currency} onChange={(event) => setRecurringForm({ ...recurringForm, currency: event.target.value, fxRate: "", accountId: "" })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {enabledCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              </div>
              <div>
                <Label>Financial account (optional)</Label>
                <select value={eligibleRecurringAccounts.some((account) => String(account.id) === recurringForm.accountId) ? recurringForm.accountId : ""} onChange={(event) => setRecurringForm({ ...recurringForm, accountId: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Do not post generated expenses to an account ledger</option>
                  {eligibleRecurringAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
                </select>
              </div>
              <div>
                <Label>Expense type</Label>
                <select value={recurringForm.expenseType} onChange={(event) => setRecurringForm({ ...recurringForm, expenseType: event.target.value as "operating" | "other" })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="operating">Operating</option><option value="other">Other expense</option>
                </select>
              </div>
              {recurringForm.currency !== baseCurrency ? <div className="sm:col-span-2"><Label>Saved rate ({recurringForm.currency} to {baseCurrency})</Label><Input required type="number" min="0.000001" step="0.000001" value={recurringForm.fxRate || String(profile.exchangeRates?.[recurringForm.currency] ?? "")} onChange={(event) => setRecurringForm({ ...recurringForm, fxRate: event.target.value })} className="mt-1" /></div> : null}
              <div><Label>Category</Label><Input value={recurringForm.categoryName} onChange={(event) => setRecurringForm({ ...recurringForm, categoryName: event.target.value })} placeholder="Optional" className="mt-1" /></div>
              <div><Label>Subcategory</Label><Input value={recurringForm.subcategoryName} onChange={(event) => setRecurringForm({ ...recurringForm, subcategoryName: event.target.value })} placeholder="Optional" className="mt-1" /></div>
              <div>
                <Label>Branch</Label>
                <select value={recurringForm.branchId} onChange={(event) => setRecurringForm({ ...recurringForm, branchId: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Business-wide</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </div>
              <div><Label>First due date</Label><Input required type="date" value={recurringForm.firstDueDate} onChange={(event) => setRecurringForm({ ...recurringForm, firstDueDate: event.target.value })} className="mt-1" /></div>
              <div><Label>End date (optional)</Label><Input type="date" min={recurringForm.firstDueDate} value={recurringForm.endDate} onChange={(event) => setRecurringForm({ ...recurringForm, endDate: event.target.value })} className="mt-1" /></div>
              <Button type="submit" disabled={planningSaving || !recurringForm.description.trim()} className="sm:col-span-2">{planningSaving ? "Saving…" : "Create schedule"}</Button>
            </form>
            <div className="space-y-2 border-t border-border pt-3">
              {planningLoading ? <p className="text-sm text-muted-foreground">Loading schedules…</p> : null}
              {!planningLoading && recurringExpenses.length === 0 ? <p className="text-sm text-muted-foreground">No recurring expense schedules yet.</p> : null}
              {recurringExpenses.map((schedule) => (
                <div key={schedule.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{schedule.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {schedule.frequency} · next {schedule.next_due_date} · {schedule.category_label || schedule.category_name || "Uncategorised"}
                      {schedule.branch_name ? ` · ${schedule.branch_name}` : ""}
                    </p>
                    <p className="mt-1 text-sm">{symbolForCurrency(schedule.currency)}{Number(schedule.amount).toLocaleString()} {schedule.currency} · base {baseSymbol}{Number(schedule.amount_base).toLocaleString()}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => void toggleRecurringExpense(schedule)} disabled={planningSaving}>
                    {schedule.is_active ? <><Pause className="mr-2 h-4 w-4" /> Pause</> : <><Play className="mr-2 h-4 w-4" /> Resume</>}
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground"><CalendarClock className="mr-1 inline h-3.5 w-3.5" />Scheduled runs can also be executed by the backend command <code>generate_recurring_expenses</code>.</p>
          </CardContent>
        </Card>
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle className="font-display">Add Expense</DialogTitle>
            <DialogDescription>Record an operating or other expense and optionally convert it into your base reporting currency.</DialogDescription>
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
              <Label>Branch</Label>
              <select value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Business-wide / not assigned</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Currency</Label>
              <select
                value={form.currency}
                onChange={e => { setForm({ ...form, currency: e.target.value, fxRate: "" }); setPaymentAccountId(""); }}
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {enabledCurrencies.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Financial account (optional)</Label>
              <select value={eligibleExpenseAccounts.some((account) => String(account.id) === paymentAccountId) ? paymentAccountId : ""} onChange={(event) => setPaymentAccountId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Do not post to an account ledger</option>
                {eligibleExpenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
              </select>
            </div>
            <div><Label>Amount ({symbolForCurrency(selectedCurrency)})</Label><Input type="number" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="mt-1" /></div>
            <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="mt-1" /></div>
            <div>
              <Label>Expense type</Label>
              <select value={form.expenseType} onChange={e => setForm({ ...form, expenseType: e.target.value as "operating" | "other" })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="operating">Operating expense</option>
                <option value="other">Other expense</option>
              </select>
            </div>
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
            <div>
              <Label>Subcategory (optional)</Label>
              <Input value={form.subcategory} onChange={(event) => setForm({ ...form, subcategory: event.target.value })} maxLength={100} placeholder={`e.g. Fuel under ${form.category}`} className="mt-1" />
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
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
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
              <div className="rounded-md bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Approval status</p>
                <p className="mt-1 font-medium capitalize">{selectedExpense.approvalStatus || "approved"}</p>
                {selectedExpense.approvalNote ? <p className="mt-1 text-sm text-muted-foreground">{selectedExpense.approvalNote}</p> : null}
              </div>
              {!isStaffSession && selectedExpense.approvalStatus === "pending" ? (
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => void reviewExpense(selectedExpense.id, "approve")}>
                    <Check className="mr-2 h-4 w-4" /> Approve and post
                  </Button>
                  <Button variant="destructive" className="flex-1" onClick={() => void reviewExpense(selectedExpense.id, "reject")}>
                    <X className="mr-2 h-4 w-4" /> Reject
                  </Button>
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
