import { useEffect, useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Plus, Trash2, Users, QrCode, Gift, Edit2, Award, Star, Trophy, Crown, HandCoins, ReceiptText, AlertTriangle, FileText, Printer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useStore, CustomerBadge } from "@/lib/store";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { addToOfflineQueue, canQueueOfflineAction, hasQueuedLocalCreate, removeQueuedLocalCreate } from "@/lib/offlineQueue";
import { buildDebtorFollowUps } from "@/lib/reporting";
import { useAuth } from "@/lib/auth-context";
import { addCustomerDebtApi, fetchCustomerStatementApi, listFinancialAccountsApi, recordCustomerPaymentApi, type ApiCustomerStatement, type ApiFinancialAccount } from "@/lib/api";

const badgeConfig: Record<CustomerBadge, { label: string; color: string; icon: typeof Award }> = {
  bronze: { label: "Bronze", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", icon: Award },
  silver: { label: "Silver", color: "bg-muted text-muted-foreground", icon: Star },
  gold: { label: "Gold", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: Trophy },
  platinum: { label: "Platinum", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400", icon: Crown },
};

const debtAgeInDays = (startedAt?: string) => {
  if (!startedAt) return 0;
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - started.getTime()) / 86400000));
};

const isPastDueDate = (value?: string) => {
  if (!value) return false;
  const due = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return !Number.isNaN(due.getTime()) && due < today;
};

const Customers = () => {
  const { customers, branches, addCustomer, updateCustomer, deleteCustomer, profile } = useStore();
  const { isStaffSession } = useAuth();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewQR, setViewQR] = useState<string | null>(null);
  const [creditModal, setCreditModal] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [debtModal, setDebtModal] = useState<{ id: string; mode: "add" | "payment" } | null>(null);
  const [debtAmount, setDebtAmount] = useState("");
  const [debtNotes, setDebtNotes] = useState("");
  const [debtDueDate, setDebtDueDate] = useState("");
  const [financialAccounts, setFinancialAccounts] = useState<ApiFinancialAccount[]>([]);
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [statementCustomerId, setStatementCustomerId] = useState<string | null>(null);
  const [customerStatement, setCustomerStatement] = useState<ApiCustomerStatement | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState("");
  const paymentRequestKey = useRef<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", badge: "bronze" as CustomerBadge, branchId: "", creditLimit: "" });
  const qrWrapperRef = useRef<HTMLDivElement | null>(null);
  const sym = profile.currencySymbol || "R";
  const eligibleCollectionAccounts = financialAccounts.filter((account) => account.is_active
    && account.currency.toUpperCase() === (profile.currency || "ZAR").toUpperCase()
    && account.opening_date <= new Date().toISOString().slice(0, 10));

  useEffect(() => {
    listFinancialAccountsApi().then((accounts) => setFinancialAccounts(accounts.filter((account) => account.is_active)))
      .catch(() => setFinancialAccounts([]));
  }, []);

  const filtered = customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search));
  const viewingCustomer = customers.find(c => c.id === viewQR);
  const creditCustomer = customers.find(c => c.id === creditModal);
  const debtCustomer = customers.find(c => c.id === debtModal?.id);
  const statementCustomer = customers.find((customer) => customer.id === statementCustomerId);
  const debtors = customers.filter(c => (c.debtAmount || 0) > 0);
  const totalDebt = debtors.reduce((sum, c) => sum + (c.debtAmount || 0), 0);
  const overdueDebtCount = debtors.filter(c => c.debtDueDate ? isPastDueDate(c.debtDueDate) : debtAgeInDays(c.debtStartedAt) >= 30).length;
  const debtorFollowUps = buildDebtorFollowUps(customers, sym);

  const openAdd = () => {
    setForm({ name: "", phone: "", badge: "bronze", branchId: branches.length === 1 ? branches[0].id : "", creditLimit: "" });
    setAddOpen(true);
  };

  const openEdit = (id: string) => {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    setForm({ name: c.name, phone: c.phone, badge: c.badge || "bronze", branchId: c.branchId || "", creditLimit: c.creditLimit?.toString() || "" });
    setEditId(id);
  };

  const handleSave = () => {
    const creditLimit = form.creditLimit.trim() ? Number(form.creditLimit) : undefined;
    if (creditLimit !== undefined && (!Number.isFinite(creditLimit) || creditLimit < 0)) {
      toast.error("Enter a valid non-negative credit limit.");
      return;
    }
    if (editId) {
      updateCustomer(editId, {
        name: form.name,
        phone: form.phone,
        badge: form.badge,
        branchId: form.branchId || undefined,
        branchName: branches.find((branch) => branch.id === form.branchId)?.name,
        creditLimit,
      });
      if (canQueueOfflineAction() && /^\d+$/.test(editId)) {
        addToOfflineQueue({ type: "customer_update", payload: { id: Number(editId), name: form.name, phone: form.phone, badge: form.badge, credit_limit: creditLimit?.toFixed(2) ?? null, branch: form.branchId ? Number(form.branchId) : null } });
      }
      setEditId(null);
      toast.success(canQueueOfflineAction() ? "Customer update saved locally." : "Customer updated!");
    } else {
      const qrCode = `VRF-CUST-${Date.now().toString(36).toUpperCase()}`;
      const localId = addCustomer({
        name: form.name,
        phone: form.phone,
        branchId: form.branchId || undefined,
        branchName: branches.find((branch) => branch.id === form.branchId)?.name,
        totalSpent: 0,
        visits: 0,
        loyaltyPoints: 0,
        qrCode,
        credits: 0,
        creditLimit,
        debtAmount: 0,
        debtNotes: "",
        lastVisit: "Never",
        badge: form.badge,
      });
      if (canQueueOfflineAction()) {
        addToOfflineQueue({
          type: "customer_create",
          payload: {
            local_id: localId,
            name: form.name,
            phone: form.phone,
            total_spent: "0.00",
            visits: 0,
            loyalty_points: 0,
            qr_code: qrCode,
            credits: "0.00",
            credit_limit: creditLimit?.toFixed(2) ?? null,
            debt_amount: "0.00",
            debt_notes: "",
            badge: form.badge,
            branch: form.branchId ? Number(form.branchId) : null,
          },
        });
      }
      setAddOpen(false);
      toast.success(canQueueOfflineAction() ? "Customer saved locally with QR code." : "Customer added with QR code!");
    }
    setForm({ name: "", phone: "", badge: "bronze", branchId: "", creditLimit: "" });
  };

  const handleAddCredit = () => {
    if (creditModal && creditAmount) {
      const amount = parseFloat(creditAmount);
      if (!isNaN(amount) && amount > 0) {
        const c = customers.find(x => x.id === creditModal);
        if (c) {
          updateCustomer(creditModal, { credits: (c.credits || 0) + amount });
          if (canQueueOfflineAction() && /^\d+$/.test(creditModal)) {
            addToOfflineQueue({ type: "customer_update", payload: { id: Number(creditModal), credits: ((c.credits || 0) + amount).toFixed(2) } });
          }
          toast.success(`${sym}${amount} credit added to ${c.name}!`);
        }
      }
    }
    setCreditAmount("");
    setCreditModal(null);
  };

  const openDebtModal = (id: string, mode: "add" | "payment") => {
    const customer = customers.find(c => c.id === id);
    setDebtModal({ id, mode });
    setDebtAmount("");
    setDebtNotes(mode === "add" ? customer?.debtNotes || "" : "");
    setDebtDueDate("");
    setPaymentAccountId("");
    paymentRequestKey.current = null;
  };

  const closeDebtModal = () => {
    setDebtModal(null);
    setDebtAmount("");
    setDebtNotes("");
    setDebtDueDate("");
    setPaymentAccountId("");
    paymentRequestKey.current = null;
  };

  const openCustomerStatement = async (customerId: string) => {
    setStatementCustomerId(customerId);
    setCustomerStatement(null);
    setStatementError("");
    if (!navigator.onLine) {
      setStatementError("Connect to the internet to load the current customer statement.");
      return;
    }
    if (!/^\d+$/.test(customerId)) {
      setStatementError("Sync this customer before loading a financial statement.");
      return;
    }
    setStatementLoading(true);
    try {
      setCustomerStatement(await fetchCustomerStatementApi(customerId));
    } catch (error) {
      setStatementError(error instanceof Error ? error.message : "Could not load this customer statement.");
    } finally {
      setStatementLoading(false);
    }
  };

  const printCustomerStatement = () => {
    if (!customerStatement) return;
    const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[character] || character);
    const symbol = customerStatement.currency_symbol || sym;
    const invoiceRows = customerStatement.invoices.map((invoice) => `<tr><td>${escapeHtml(invoice.invoice_number || `INV-${invoice.id}`)}</td><td>${escapeHtml(invoice.date)}</td><td>${escapeHtml(invoice.due_date || "—")}</td><td>${escapeHtml(Number(invoice.total).toFixed(2))}</td><td>${escapeHtml(Number(invoice.amount_paid_base).toFixed(2))}</td><td>${escapeHtml(Number(invoice.balance_due).toFixed(2))}</td></tr>`).join("");
    const transactionRows = customerStatement.transactions.map((item) => `<tr><td>${escapeHtml(new Date(item.created_at).toLocaleDateString())}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.reason)}</td><td>${escapeHtml(Number(item.amount).toFixed(2))}</td></tr>`).join("");
    const printWindow = window.open("", "_blank", "width=900,height=900");
    if (!printWindow) {
      toast.error("Allow pop-ups to print this statement.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><title>Statement - ${escapeHtml(customerStatement.customer.name)}</title><meta charset="utf-8"><style>body{font:14px Arial,sans-serif;color:#222;margin:32px}h1{font-size:22px}h2{font-size:16px;margin-top:28px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}th{background:#f4f4f0}.total{font-size:18px;font-weight:bold;margin-top:20px}@media print{body{margin:15mm}}</style></head><body><h1>Customer statement</h1><p><strong>${escapeHtml(customerStatement.customer.name)}</strong><br>${escapeHtml(customerStatement.customer.phone)}<br>Generated ${escapeHtml(new Date(customerStatement.generated_at).toLocaleString())}</p><h2>Invoices</h2><table><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Total (${escapeHtml(symbol)})</th><th>Paid (${escapeHtml(symbol)})</th><th>Outstanding (${escapeHtml(symbol)})</th></tr></thead><tbody>${invoiceRows || "<tr><td colspan=\"6\">No invoices</td></tr>"}</tbody></table><h2>Account transactions</h2><table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Amount (${escapeHtml(symbol)})</th></tr></thead><tbody>${transactionRows || "<tr><td colspan=\"4\">No account transactions</td></tr>"}</tbody></table><p class="total">Current balance: ${escapeHtml(symbol)}${escapeHtml(Number(customerStatement.customer.debt_amount).toFixed(2))}</p></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  };

  const handleDebtSave = async () => {
    if (!debtModal || !debtCustomer) return;
    const amount = parseFloat(debtAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }

    if (!navigator.onLine) {
      toast.error("Customer debt and payment entries need an internet connection. No change was recorded.");
      return;
    }
    if (!/^\d+$/.test(debtModal.id)) {
      toast.error("Sync this customer before posting financial transactions.");
      return;
    }
    const idempotencyKey = paymentRequestKey.current || (paymentRequestKey.current = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const result = debtModal.mode === "add"
        ? await addCustomerDebtApi(debtModal.id, {
            amount: amount.toFixed(2),
            reason: debtNotes.trim(),
            ...(debtDueDate ? { due_date: debtDueDate } : {}),
            idempotency_key: idempotencyKey,
          })
        : await recordCustomerPaymentApi(debtModal.id, {
            amount: amount.toFixed(2),
            reason: "Customer payment",
            idempotency_key: idempotencyKey,
            ...(paymentAccountId && eligibleCollectionAccounts.some((account) => String(account.id) === paymentAccountId)
              ? { payment_allocations: [{ currency: profile.currency || "ZAR", amount: amount.toFixed(2), account: Number(paymentAccountId) }] }
              : {}),
          });
      const nextDebt = Number(result.debt_amount) || 0;
      updateCustomer(debtModal.id, {
        debtAmount: nextDebt,
        debtStartedAt: result.debt_started_at || undefined,
        debtUpdatedAt: result.debt_updated_at || undefined,
        debtDueDate: result.debt_due_date || undefined,
        debtNotes: result.debt_notes || "",
      });
      toast.success(
        debtModal.mode === "add"
          ? `${sym}${amount.toFixed(2)} debt added to ${debtCustomer.name}.`
          : `${sym}${amount.toFixed(2)} payment recorded. Balance: ${sym}${nextDebt.toFixed(2)}.`,
      );
      closeDebtModal();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the customer credit transaction.");
    }
  };

  const downloadQRCode = () => {
    if (!qrWrapperRef.current || !viewingCustomer) return;
    const svg = qrWrapperRef.current.querySelector("svg");
    if (!svg) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${viewingCustomer.name.replace(/\s+/g, "-").toLowerCase()}-${viewingCustomer.qrCode}.svg`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const printQRCode = () => {
    if (!qrWrapperRef.current) return;
    const svg = qrWrapperRef.current.querySelector("svg");
    if (!svg) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const encodedSvg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    const html = `<!DOCTYPE html><html><head><title>Print QR Code</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;}img{width:100%;height:auto;max-width:420px;}</style></head><body><img alt="Customer QR Code" src="${encodedSvg}" /></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, "_blank", "width=600,height=700");
    if (!printWindow) return;
    printWindow.focus();
    printWindow.onload = () => {
      printWindow.print();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  };

  const shareQRCode = async () => {
    if (!viewingCustomer) return;
    const message = `Customer QR for ${viewingCustomer.name}: ${viewingCustomer.qrCode}`;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(message);
        toast.success("QR details copied to clipboard.");
      }
    } catch {
      // ignore clipboard write failure
    }
    window.open(`mailto:?subject=Customer QR Code&body=${encodeURIComponent(message)}`);
  };

  const copyFollowUpMessage = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Follow-up message copied.");
    } catch {
      toast.error("Could not copy message.");
    }
  };

  const formDialog = (
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
      <DialogHeader>
        <DialogTitle className="font-display">{editId ? "Edit Customer" : "Add Customer"}</DialogTitle>
        <DialogDescription>
          {editId ? "Update the customer's details and loyalty badge." : "Add a customer profile and generate a QR code for future visits."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div><Label>Customer Name</Label><Input placeholder="e.g. John's Hardware" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1" /></div>
        <div><Label>Phone Number</Label><Input placeholder="+27 82 555 0101" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="mt-1" /></div>
        <div>
          <Label>Credit Limit ({sym})</Label>
          <Input type="number" min="0" step="0.01" placeholder="Leave blank for no limit" value={form.creditLimit} onChange={e => setForm({ ...form, creditLimit: e.target.value })} className="mt-1" />
          <p className="mt-1 text-xs text-muted-foreground">Credit sales are blocked when this customer's outstanding balance would exceed the limit.</p>
        </div>
        <div>
          <Label htmlFor="customer-branch">Branch</Label>
          <select
            id="customer-branch"
            value={form.branchId}
            onChange={(event) => setForm({ ...form, branchId: event.target.value })}
            disabled={isStaffSession}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {!isStaffSession && <option value="">Business-wide / not assigned</option>}
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
          {isStaffSession && <p className="mt-1 text-xs text-muted-foreground">This customer is assigned to your authorised branch.</p>}
        </div>
        <div>
          <Label htmlFor="customer-badge">Customer Badge</Label>
          <select id="customer-badge" aria-label="Customer Badge" value={form.badge} onChange={e => setForm({ ...form, badge: e.target.value as CustomerBadge })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="bronze">Bronze</option>
            <option value="silver">Silver</option>
            <option value="gold">Gold</option>
            <option value="platinum">Platinum</option>
          </select>
        </div>
        {!editId && <p className="text-xs text-muted-foreground">A unique QR code will be automatically generated for this customer.</p>}
        <Button onClick={handleSave} disabled={!form.name.trim()} className="w-full bg-gradient-hero text-primary-foreground">{editId ? "Update" : "Add"} Customer</Button>
      </div>
    </DialogContent>
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={openAdd} className="bg-gradient-hero text-primary-foreground"><Plus className="h-4 w-4 mr-2" /> Add Customer</Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Debtors</p>
          <p className="font-display text-xl font-bold">{debtors.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Owed</p>
          <p className="font-display text-xl font-bold">{sym}{totalDebt.toFixed(2)}</p>
        </div>
        <div className={`rounded-lg border p-4 ${overdueDebtCount > 0 ? "border-destructive/40 bg-destructive/10" : "border-border bg-card"}`}>
          <p className="text-xs text-muted-foreground">Past due / 30+ days</p>
          <p className={`font-display text-xl font-bold ${overdueDebtCount > 0 ? "text-destructive" : ""}`}>{overdueDebtCount}</p>
        </div>
      </div>

      {debtorFollowUps.length > 0 && (
        <Card className="shadow-soft">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-display font-semibold">Payment Follow-Up Queue</p>
                <p className="text-xs text-muted-foreground">Ready-to-send reminders for customers with outstanding balances.</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {debtorFollowUps.slice(0, 4).map((item) => (
                <div key={`${item.customer}-${item.phone}`} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{item.customer}</p>
                      <p className="text-xs text-muted-foreground">{sym}{item.amount.toFixed(2)} | {item.ageDays} day{item.ageDays === 1 ? "" : "s"} old</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => copyFollowUpMessage(item.message)}>Copy</Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{item.message}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet" description="Add your first customer to start tracking" actionLabel="Add Customer" onAction={openAdd} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {filtered.map((c) => {
            const badge = badgeConfig[c.badge || "bronze"];
            const BadgeIcon = badge.icon;
            const debtAmount = c.debtAmount || 0;
            const debtAge = debtAgeInDays(c.debtStartedAt);
            const isOverdueDebt = debtAmount > 0 && (c.debtDueDate ? isPastDueDate(c.debtDueDate) : debtAge >= 30);
            return (
              <Card key={c.id} className={`shadow-soft group cursor-pointer hover:shadow-elevated transition-shadow ${isOverdueDebt ? "border-destructive/50" : ""}`} onClick={() => openEdit(c.id)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-display font-semibold">{c.name}</p>
                        <Badge className={`${badge.color} gap-1`}>
                          <BadgeIcon className="h-3 w-3" />
                          {badge.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.phone}</p>
                    </div>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <button aria-label="Edit customer" onClick={() => openEdit(c.id)} className="p-1.5 rounded hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      <button aria-label="View customer QR code" onClick={() => setViewQR(c.id)} className="p-1.5 rounded hover:bg-muted"><QrCode className="h-3.5 w-3.5 text-primary" /></button>
                      <button aria-label="Add credit to customer" onClick={() => setCreditModal(c.id)} className="p-1.5 rounded hover:bg-muted"><Gift className="h-3.5 w-3.5 text-accent" /></button>
                      <button aria-label="Add customer debt" onClick={() => openDebtModal(c.id, "add")} className="p-1.5 rounded hover:bg-muted"><HandCoins className="h-3.5 w-3.5 text-amber-600" /></button>
                      {debtAmount > 0 && <button aria-label="Record partial payment" onClick={() => openDebtModal(c.id, "payment")} className="p-1.5 rounded hover:bg-muted"><ReceiptText className="h-3.5 w-3.5 text-success" /></button>}
                      {debtAmount > 0 && <button aria-label={`View statement for ${c.name}`} onClick={() => void openCustomerStatement(c.id)} className="p-1.5 rounded hover:bg-muted"><FileText className="h-3.5 w-3.5 text-primary" /></button>}
                      <button aria-label="Delete customer" onClick={() => setDeleteId(c.id)} className="p-1.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-3 text-xs">
                    <div><strong className="font-display">{sym}{c.totalSpent.toLocaleString()}</strong><br /><span className="text-muted-foreground">spent</span></div>
                    <div><strong className="font-display">{c.visits}</strong><br /><span className="text-muted-foreground">visits</span></div>
                    <div><strong className="font-display">{c.loyaltyPoints}</strong><br /><span className="text-muted-foreground">points</span></div>
                    <div><strong className="font-display text-success">{sym}{(c.credits || 0).toFixed(2)}</strong><br /><span className="text-muted-foreground">credits</span></div>
                  </div>
                  {debtAmount > 0 && (
                    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${isOverdueDebt ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 font-medium">
                          {isOverdueDebt && <AlertTriangle className="h-3.5 w-3.5" />}
                          Owes {sym}{debtAmount.toFixed(2)}
                        </span>
                        <span>{debtAge} day{debtAge === 1 ? "" : "s"}</span>
                      </div>
                      {c.debtDueDate ? <p className="mt-1">Due {c.debtDueDate}{isPastDueDate(c.debtDueDate) ? " · overdue" : ""}</p> : null}
                      {c.debtNotes && <p className="mt-1 text-muted-foreground">{c.debtNotes}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>{formDialog}</Dialog>
      <Dialog open={!!editId} onOpenChange={() => setEditId(null)}>{formDialog}</Dialog>

      {/* QR Code View */}
      <Dialog open={!!viewQR} onOpenChange={() => setViewQR(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Customer QR Code</DialogTitle>
            <DialogDescription>View, print, or share this customer's QR code and loyalty summary.</DialogDescription>
          </DialogHeader>
          {viewingCustomer && (
            <div className="text-center space-y-4">
              <div ref={qrWrapperRef} className="bg-card p-6 rounded-xl inline-block mx-auto border border-border">
                <QRCodeSVG value={JSON.stringify({ id: viewingCustomer.qrCode, name: viewingCustomer.name })} size={200} level="H" />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-center gap-2">
                <Button onClick={downloadQRCode} className="w-full sm:w-auto">Download QR</Button>
                <Button variant="outline" onClick={printQRCode} className="w-full sm:w-auto">Print QR</Button>
                <Button variant="secondary" onClick={shareQRCode} className="w-full sm:w-auto">Share QR</Button>
              </div>
              <div>
                <p className="font-display font-semibold">{viewingCustomer.name}</p>
                <p className="text-xs text-muted-foreground">{viewingCustomer.qrCode}</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-lg bg-muted/50"><p className="font-display font-bold">{viewingCustomer.visits}</p><p className="text-xs text-muted-foreground">Visits</p></div>
                <div className="p-3 rounded-lg bg-muted/50"><p className="font-display font-bold">{viewingCustomer.loyaltyPoints}</p><p className="text-xs text-muted-foreground">Points</p></div>
                <div className="p-3 rounded-lg bg-success/10"><p className="font-display font-bold text-success">{sym}{(viewingCustomer.credits || 0).toFixed(2)}</p><p className="text-xs text-muted-foreground">Credits</p></div>
              </div>
              {(viewingCustomer.debtAmount || 0) > 0 && (
                <div className={`p-3 rounded-lg text-left ${(debtAgeInDays(viewingCustomer.debtStartedAt) >= 30) ? "bg-destructive/10 text-destructive" : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"}`}>
                  <p className="font-display font-bold">Owes {sym}{(viewingCustomer.debtAmount || 0).toFixed(2)}</p>
                  <p className="text-xs">Age: {debtAgeInDays(viewingCustomer.debtStartedAt)} days</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Print or share this QR code with the customer.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Credit Dialog */}
      <Dialog open={!!creditModal} onOpenChange={() => setCreditModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Add Credit / Reward</DialogTitle>
            <DialogDescription>Add store credit to the selected customer account.</DialogDescription>
          </DialogHeader>
          {creditCustomer && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="font-medium text-sm">{creditCustomer.name}</p>
                <p className="text-xs text-muted-foreground">{creditCustomer.visits} visits · Current credit: {sym}{(creditCustomer.credits || 0).toFixed(2)}</p>
              </div>
              <div>
                <Label>Credit Amount ({sym})</Label>
                <Input type="number" placeholder="e.g. 20" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} className="mt-1" />
              </div>
              <Button onClick={handleAddCredit} disabled={!creditAmount} className="w-full bg-gradient-accent text-accent-foreground">Add Credit</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!statementCustomerId} onOpenChange={(open) => { if (!open) { setStatementCustomerId(null); setCustomerStatement(null); setStatementError(""); } }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle className="font-display">Customer statement</DialogTitle>
            <DialogDescription>{statementCustomer?.name || "Account activity, invoices, payments, and outstanding balance."}</DialogDescription>
          </DialogHeader>
          {statementLoading ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">Loading statement…</p> : null}
          {statementError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{statementError}</p> : null}
          {customerStatement ? <div className="space-y-5">
            <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{customerStatement.customer.name}</p>
                <p className="text-xs text-muted-foreground">{customerStatement.customer.phone || "No phone recorded"} · Generated {new Date(customerStatement.generated_at).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold">Outstanding: {customerStatement.currency_symbol}{Number(customerStatement.customer.debt_amount).toFixed(2)}</p>
                <Button size="sm" variant="outline" onClick={printCustomerStatement}><Printer className="mr-2 h-4 w-4" />Print</Button>
              </div>
            </div>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Invoices</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[650px] text-sm">
                  <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground"><th className="p-2">Invoice</th><th className="p-2">Date</th><th className="p-2">Due date</th><th className="p-2 text-right">Original</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Outstanding</th></tr></thead>
                  <tbody>{customerStatement.invoices.map((invoice) => <tr key={invoice.id} className="border-b last:border-0"><td className="p-2 font-medium">{invoice.invoice_number || `INV-${invoice.id}`}</td><td className="p-2">{invoice.date}</td><td className="p-2">{invoice.due_date || "—"}</td><td className="p-2 text-right">{customerStatement.currency_symbol}{Number(invoice.total).toFixed(2)}</td><td className="p-2 text-right">{customerStatement.currency_symbol}{Number(invoice.amount_paid_base).toFixed(2)}</td><td className="p-2 text-right">{customerStatement.currency_symbol}{Number(invoice.balance_due).toFixed(2)}</td></tr>)}</tbody>
                </table>
              </div>
              {customerStatement.invoices.length === 0 ? <p className="text-sm text-muted-foreground">No sales invoices are linked to this customer.</p> : null}
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Account transactions</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[550px] text-sm">
                  <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground"><th className="p-2">Date</th><th className="p-2">Type</th><th className="p-2">Reference</th><th className="p-2 text-right">Amount</th></tr></thead>
                  <tbody>{customerStatement.transactions.map((transaction) => <tr key={transaction.id} className="border-b last:border-0"><td className="p-2">{new Date(transaction.created_at).toLocaleDateString()}</td><td className="p-2 capitalize">{transaction.type}</td><td className="p-2">{transaction.reason || "—"}</td><td className="p-2 text-right">{customerStatement.currency_symbol}{Number(transaction.amount).toFixed(2)}</td></tr>)}</tbody>
                </table>
              </div>
              {customerStatement.transactions.length === 0 ? <p className="text-sm text-muted-foreground">No account transactions recorded.</p> : null}
            </section>
          </div> : null}
        </DialogContent>
      </Dialog>

      {/* Debt Dialog */}
      <Dialog open={!!debtModal} onOpenChange={closeDebtModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">{debtModal?.mode === "payment" ? "Record Partial Payment" : "Add Customer Debt"}</DialogTitle>
            <DialogDescription>
              {debtModal?.mode === "payment" ? "Reduce the outstanding balance after a customer pays part of what they owe." : "Track goods taken now and paid later."}
            </DialogDescription>
          </DialogHeader>
          {debtCustomer && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="font-medium text-sm">{debtCustomer.name}</p>
                <p className="text-xs text-muted-foreground">Current balance: {sym}{(debtCustomer.debtAmount || 0).toFixed(2)}</p>
              </div>
              <div>
                <Label>{debtModal?.mode === "payment" ? "Payment Amount" : "Debt Amount"} ({sym})</Label>
                <Input type="number" min="0" step="0.01" placeholder={debtModal?.mode === "payment" ? "e.g. 2" : "e.g. 5"} value={debtAmount} onChange={e => setDebtAmount(e.target.value)} className="mt-1" />
              </div>
              {debtModal?.mode === "payment" ? (
                <div>
                  <Label>Financial account (optional)</Label>
                  <select value={eligibleCollectionAccounts.some((account) => String(account.id) === paymentAccountId) ? paymentAccountId : ""} onChange={(event) => setPaymentAccountId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Do not post to an account ledger</option>
                    {eligibleCollectionAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
                  </select>
                </div>
              ) : null}
              {debtModal?.mode === "add" && (
                <>
                  <div>
                    <Label>Due Date</Label>
                    <Input type="date" value={debtDueDate} onChange={e => setDebtDueDate(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label>Note</Label>
                    <Input placeholder="e.g. goods taken on credit" value={debtNotes} onChange={e => setDebtNotes(e.target.value)} className="mt-1" />
                  </div>
                </>
              )}
              <Button onClick={handleDebtSave} disabled={!debtAmount} className="w-full">
                {debtModal?.mode === "payment" ? "Record Payment" : "Add Debt"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmationModal open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Delete Customer" description="Remove this customer?" confirmLabel="Delete" variant="destructive" onConfirm={() => { if (deleteId) { if (canQueueOfflineAction()) { if (hasQueuedLocalCreate("customer_create", deleteId)) removeQueuedLocalCreate("customer_create", deleteId); else if (/^\d+$/.test(deleteId)) addToOfflineQueue({ type: "customer_delete", payload: { id: Number(deleteId) } }); } deleteCustomer(deleteId); } setDeleteId(null); }} />
    </div>
  );
};

export default Customers;
