import { useEffect, useMemo, useRef, useState } from "react";
import { closeTillApi, createSaleApi, createTillCashMovementApi, deleteSaleApi, fetchReceiptApi, fetchWhatsAppReceiptApi, getCurrentTillApi, listExpensesApi, listFinancialAccountsApi, listTillSessionsApi, openTillApi, reviewTillApi, type ApiExpense, type ApiFinancialAccount, type ApiTillCashMovement, type ApiTillSession } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { addToOfflineQueue, canQueueOfflineAction } from "@/lib/offlineQueue";
import { motion } from "framer-motion";
import { Plus, Search, ArrowUpRight, ArrowDownRight, Trash2, ShoppingCart, Receipt, Wallet, ScanBarcode, MessageCircle, Printer } from "lucide-react";
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
import { barcodeMatches, normalizeBarcode } from "@/lib/barcodes";
import { displayBusinessDate, isSameBusinessDay } from "@/lib/reporting";
import { useNavigate, useSearchParams } from "react-router-dom";

interface SaleLineItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
}

const SHOW_SPLIT_PAYMENT = false;

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function createSaleIntegrationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const Sales = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { sales, deleteSale, profile, products, customers, branches, addSale } = useStore();
  const { refreshUser, isStaffSession, staffSession } = useAuth();
  const { canUse } = useFeatureAccess();
  const promptUpgrade = useUpgradePrompt();
  const canUseMultiBranch = canUse("multi_branch");
  const [search, setSearch] = useState("");
  const [salesBranchFilter, setSalesBranchFilter] = useState("all");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [invoiceMode, setInvoiceMode] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [tillOpen, setTillOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptText, setReceiptText] = useState("");
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);
  const [receiptPhone, setReceiptPhone] = useState("");
  const [firstSalePrompt, setFirstSalePrompt] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [till, setTill] = useState<ApiTillSession | null>(null);
  const [tillHistory, setTillHistory] = useState<ApiTillSession[]>([]);
  const [tillExpenses, setTillExpenses] = useState<ApiExpense[]>([]);
  const [tillExpensesError, setTillExpensesError] = useState("");
  const [savingTillMovement, setSavingTillMovement] = useState(false);
  const [tillMovementForm, setTillMovementForm] = useState({
    movementType: "withdrawal" as ApiTillCashMovement["movement_type"],
    amount: "",
    expense: "",
    note: "",
  });
  const [tillForm, setTillForm] = useState({ cashier: "", openingCash: "0", closingCash: "", notes: "" });
  const [reviewDialogSession, setReviewDialogSession] = useState<ApiTillSession | null>(null);
  const [tillReviewNote, setTillReviewNote] = useState("");
  const [tillReviewSaving, setTillReviewSaving] = useState(false);
  const [tillHistoryError, setTillHistoryError] = useState("");
  const canReviewTills = !isStaffSession || ["Owner", "Manager"].includes(staffSession?.role || "");
  const [method, setMethod] = useState<"Cash" | "EFT" | "Card" | "Credit">("Cash");
  const [creditPaidAmount, setCreditPaidAmount] = useState("0");
  const [creditPaymentMethod, setCreditPaymentMethod] = useState<"Cash" | "EFT" | "Card">("Cash");
  const [creditDueDate, setCreditDueDate] = useState("");
  const [lineItems, setLineItems] = useState<SaleLineItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [qty, setQty] = useState("1");
  const [paymentCurrency, setPaymentCurrency] = useState(profile.currency);
  const [financialAccounts, setFinancialAccounts] = useState<ApiFinancialAccount[]>([]);
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [paymentRate, setPaymentRate] = useState("");
  const [canUseCameraScan, setCanUseCameraScan] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const saleIntegrationIdRef = useRef<string | null>(null);
  const tillMovementKeyRef = useRef<string | null>(null);
  const baseCurrency = profile.currency || "ZAR";
  const sym = profile.currencySymbol || symbolForCurrency(baseCurrency);
  const enabledCurrencies = profile.enabledCurrencies?.length ? profile.enabledCurrencies : [baseCurrency];
  const secondaryCurrency = enabledCurrencies.find((code) => code !== baseCurrency) || "";
  const effectivePaymentCurrency = method === "Credit" ? baseCurrency : paymentCurrency;
  const availablePaymentAccounts = financialAccounts.filter((account) =>
    account.is_active && account.currency.toUpperCase() === effectivePaymentCurrency.toUpperCase()
    && account.opening_date <= new Date().toISOString().slice(0, 10)
  );
  const linkedTillExpenseIds = new Set((till?.cash_movements || [])
    .map((movement) => movement.expense)
    .filter((id): id is number => id !== null));
  const eligibleTillExpenses = tillExpenses.filter((expense) => {
    if (linkedTillExpenseIds.has(expense.id) || expense.approval_status === "rejected" || expense.branch !== (till?.branch ?? null)) return false;
    return (expense.payment_allocations || []).every((allocation) => {
      if (!allocation.account) return true;
      return financialAccounts.find((account) => account.id === allocation.account)?.account_type === "cash";
    });
  });

  useEffect(() => {
    listFinancialAccountsApi().then((accounts) => {
      const active = accounts.filter((account) => account.is_active);
      setFinancialAccounts(active);
      const baseAccounts = active.filter((account) => account.currency.toUpperCase() === baseCurrency.toUpperCase());
      if (baseAccounts.length === 1) setPaymentAccountId(String(baseAccounts[0].id));
    }).catch(() => setFinancialAccounts([]));
  }, [baseCurrency]);

  useEffect(() => {
    if (!canUseMultiBranch) {
      setSelectedBranchId("");
      return;
    }
    if (selectedBranchId && branches.some((branch) => branch.id === selectedBranchId)) return;
    setSelectedBranchId(branches.find((branch) => branch.isPrimary)?.id || "");
  }, [branches, canUseMultiBranch, selectedBranchId]);

  useEffect(() => {
    getCurrentTillApi().then(setTill).catch(() => setTill(null));
    let cancelled = false;
    listTillSessionsApi()
      .then((sessions) => {
        if (!cancelled) {
          setTillHistory(sessions);
          setTillHistoryError("");
        }
      })
      .catch((error) => {
        if (!cancelled) setTillHistoryError(error instanceof Error ? error.message : "Till history could not be loaded.");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!till?.id) {
      setTillExpenses([]);
      setTillExpensesError("");
      return;
    }
    listExpensesApi().then((rows) => {
      setTillExpenses(rows);
      setTillExpensesError("");
    }).catch((error) => {
      setTillExpenses([]);
      setTillExpensesError(error instanceof Error ? error.message : "Cash expenses could not be loaded.");
    });
  }, [till?.id]);

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

  useEffect(() => {
    if (searchParams.get("action") !== "add") return;
    const createInvoice = searchParams.get("invoice") === "1";
    if (!products.some((product) => product.stock > 0 && product.price > 0)) {
      toast.info("Add a product with opening stock and a selling price before recording a sale.");
      navigate("/inventory?action=add&onboarding=first-product", { replace: true });
      return;
    }
    setInvoiceMode(createInvoice);
    if (createInvoice) {
      setSelectedCustomerId("");
      setMethod("Cash");
    }
    setAddOpen(true);
    setFirstSalePrompt(searchParams.get("onboarding") === "first-sale");
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("action");
    nextParams.delete("onboarding");
    nextParams.delete("invoice");
    setSearchParams(nextParams, { replace: true });
  }, [navigate, products, searchParams, setSearchParams]);

  const branchSales = sales.filter((sale) =>
    salesBranchFilter === "all" ||
    (salesBranchFilter === "unassigned" ? !sale.branchId : sale.branchId === salesBranchFilter)
  );
  const availableProducts = products.filter((product) =>
    product.stock > 0 &&
    (!canUseMultiBranch || (selectedBranchId ? !product.branchId || product.branchId === selectedBranchId : !product.branchId))
  );
  const filtered = branchSales.filter(s => String(s.items || "").toLowerCase().includes(search.toLowerCase()));
  const todayTotal = branchSales.filter(s => isSameBusinessDay(s.date)).reduce((sum, s) => sum + s.total, 0);
  const todayCount = branchSales.filter(s => isSameBusinessDay(s.date)).length;
  const previousDay = new Date();
  previousDay.setDate(previousDay.getDate() - 1);
  const previousDaySales = branchSales.filter(s => isSameBusinessDay(s.date, previousDay));
  const previousDayTotal = previousDaySales.reduce((sum, s) => sum + s.total, 0);
  const salesChangeLabel = previousDayTotal > 0
    ? `${Math.round(((todayTotal - previousDayTotal) / previousDayTotal) * 100)}% vs yesterday`
    : todayTotal > 0 ? "No prior-day baseline" : "No sales recorded today";
  const transactionChangeLabel = previousDaySales.length > 0
    ? `${todayCount - previousDaySales.length >= 0 ? "+" : ""}${todayCount - previousDaySales.length} vs yesterday`
    : todayCount > 0 ? "No prior-day baseline" : "No transactions today";
  const saleTotal = lineItems.reduce((sum, l) => sum + l.quantity * (l.unitPrice - l.discountAmount), 0);
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
    setCreditPaidAmount("0");
    setCreditPaymentMethod("Cash");
    setCreditDueDate("");
    setPaymentCurrency(baseCurrency);
    setPaymentRate("");
  };

  const addProductToSale = (productId: string, quantity = 1) => {
    const product = products.find(p => p.id === productId);
    if (!product) return false;
    if (canUseMultiBranch && selectedBranchId && product.branchId && product.branchId !== selectedBranchId) {
      toast.error(`${product.name} is assigned to another branch.`);
      return false;
    }
    const unitPrice = parseFloat(String(product.price || 0)) || 0;
    if (quantity > product.stock) {
      toast.error(`Only ${product.stock} ${product.name} in stock`);
      return false;
    }
    if (unitPrice <= 0) {
      toast.error("Set a product selling price greater than zero before recording the sale.");
      return false;
    }
    saleIntegrationIdRef.current = null;
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
      setLineItems([...lineItems, { productId: product.id, productName: product.name, quantity, unitPrice, discountAmount: 0 }]);
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
    const code = normalizeBarcode(rawCode);
    if (!code) return;
    const quantity = parseInt(qty, 10) || 1;

    const matchedProduct = products.find((product) => barcodeMatches(product.barcode, code));
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

  const removeLineItem = (idx: number) => {
    saleIntegrationIdRef.current = null;
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };

  const paymentAllocations = useMemo(() => {
    const rows: Array<{ currency: string; amount: number; fx_rate_to_base?: number; account?: number }> = [];
    if (method === "Credit") {
      const amount = Number(creditPaidAmount);
      const account = availablePaymentAccounts.find((candidate) => String(candidate.id) === paymentAccountId);
      if (Number.isFinite(amount) && amount > 0) rows.push({ currency: baseCurrency, amount, ...(account ? { account: account.id } : {}) });
      return rows;
    }
    if (SHOW_SPLIT_PAYMENT && alternateCurrency && splitAmountValue > 0) {
      rows.push({
        currency: alternateCurrency,
        amount: splitAmountValue,
        fx_rate_to_base: alternateCurrency === baseCurrency ? undefined : alternateFxRate,
        ...(availablePaymentAccounts.find((candidate) => String(candidate.id) === paymentAccountId && candidate.currency === alternateCurrency) ? { account: Number(paymentAccountId) } : {}),
      });
    }
    if (saleTotal > 0) {
      rows.push({
        currency: paymentCurrency,
        amount: primaryAmountPreview,
        fx_rate_to_base: paymentCurrency === baseCurrency ? undefined : paymentFxRate,
        ...(availablePaymentAccounts.find((candidate) => String(candidate.id) === paymentAccountId) ? { account: Number(paymentAccountId) } : {}),
      });
    }
    return rows.filter((row) => row.amount > 0);
  }, [method, creditPaidAmount, alternateCurrency, splitAmountValue, alternateFxRate, baseCurrency, saleTotal, paymentCurrency, primaryAmountPreview, paymentFxRate, availablePaymentAccounts, paymentAccountId]);

  const createOfflineSale = () => {
    addSale({
      items: lineItems.map((l) => `${l.quantity} ${l.productName}`).join(", "),
      total: saleTotal,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      method,
      paymentCurrency,
      paymentAllocations: paymentAllocations.map((row) => ({
        currency: row.currency,
        amount: row.amount,
        amountBase: roundMoney(row.amount * (row.fx_rate_to_base || 1)),
        account: row.account,
      })),
      saleItems: lineItems,
      customerId: selectedCustomerId || undefined,
      branchId: selectedBranchId || undefined,
    });
  };

  const handleAdd = async () => {
    if (lineItems.length === 0) return;
    if (invoiceMode && !selectedCustomerId) {
      toast.error("Select a saved customer so the invoice can be issued to them.");
      return;
    }
    if (invoiceMode && !/^\d+$/.test(selectedCustomerId)) {
      toast.error("Sync this customer before issuing an invoice.");
      return;
    }
    if (invoiceMode && !navigator.onLine) {
      toast.error("Connect to the internet to issue an invoice number.");
      return;
    }
    const unsyncedProduct = lineItems.find((item) => {
      const productId = Number(item.productId);
      return !Number.isSafeInteger(productId) || productId <= 0;
    });
    if (unsyncedProduct) {
      toast.error(`${unsyncedProduct.productName} is not synced to the server yet. Reconnect and wait for inventory to sync before recording this sale.`);
      return;
    }
    if (saleTotal <= 0) {
      toast.error("Add at least one item with a product selling price greater than zero.");
      return;
    }

    if (method === "Credit" && !selectedCustomerId) {
      toast.error("Select a customer before recording a credit sale.");
      return;
    }
    const paidOnCreditSale = Number(creditPaidAmount);
    if (method === "Credit" && (!Number.isFinite(paidOnCreditSale) || paidOnCreditSale < 0 || paidOnCreditSale > saleTotal)) {
      toast.error("Enter a payment amount between zero and the sale total.");
      return;
    }
    if (method !== "Credit" && paymentCurrency !== baseCurrency && paymentFxRate <= 0) {
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

    const integrationId = saleIntegrationIdRef.current || createSaleIntegrationId();
    saleIntegrationIdRef.current = integrationId;
    setSaving(true);

    const apiPayload = {
      integration_id: integrationId,
      payment_method: method === "Credit" ? (paidOnCreditSale > 0 ? creditPaymentMethod : "Credit") : method,
      payment_currency: method === "Credit" ? baseCurrency : paymentCurrency,
      ...(method === "Credit" && creditDueDate ? { due_date: creditDueDate } : {}),
      branch: till?.branch ?? (selectedBranchId ? Number(selectedBranchId) : null),
      till_session: till?.id || null,
      customer: selectedCustomerId ? Number(selectedCustomerId) : null,
      sale_items: lineItems.map((l) => ({
        product: parseInt(l.productId, 10),
        quantity: l.quantity,
        unit_price: l.unitPrice.toFixed(2),
        discount_amount: l.discountAmount.toFixed(2),
        subtotal: (l.quantity * (l.unitPrice - l.discountAmount)).toFixed(2),
      })),
    };
    const offlinePayload = {
      integration_id: integrationId,
      payment_method: method === "Credit" ? (paidOnCreditSale > 0 ? creditPaymentMethod : "Credit") : method,
      payment_currency: method === "Credit" ? baseCurrency : paymentCurrency,
      ...(method === "Credit" && creditDueDate ? { due_date: creditDueDate } : {}),
      branch: till?.branch ?? (selectedBranchId ? Number(selectedBranchId) : null),
      till_session: till?.id || null,
      customer: selectedCustomerId ? Number(selectedCustomerId) : null,
      sale_items: lineItems.map((l) => {
        const productId = parseInt(l.productId, 10);
        return {
          product: Number.isFinite(productId) ? productId : null,
          product_local_id: l.productId,
          product_name: l.productName,
          quantity: l.quantity,
          unit_price: l.unitPrice.toFixed(2),
          discount_amount: l.discountAmount.toFixed(2),
          subtotal: (l.quantity * (l.unitPrice - l.discountAmount)).toFixed(2),
        };
      }),
    };

    if (paymentAllocations.length > 0) {
      Object.assign(apiPayload, { payment_allocations: paymentAllocations });
      Object.assign(offlinePayload, {
        payment_allocations: paymentAllocations.map((row) => ({
          currency: row.currency,
          amount: row.amount.toFixed(2),
          fx_rate_to_base: row.fx_rate_to_base,
          account: row.account,
        })),
      });
    }

    if (method === "Credit" && !navigator.onLine) {
      toast.error("Credit sales need an internet connection so the customer balance stays accurate.");
      setSaving(false);
      return;
    }

    if (!navigator.onLine && !canQueueOfflineAction()) {
      toast.error("Offline mode is available after you have signed in on this device.");
      setSaving(false);
      return;
    }

    if (invoiceMode && canQueueOfflineAction()) {
      toast.error("Reconnect before issuing an invoice number. This invoice was not recorded.");
      setSaving(false);
      return;
    }

    if (canQueueOfflineAction() && method !== "Credit" && !invoiceMode) {
      createOfflineSale();
      addToOfflineQueue({ type: "sale", payload: offlinePayload });
      saleIntegrationIdRef.current = null;
      toast.success(firstSalePrompt
        ? "First sale saved locally. It will sync automatically when you are back online."
        : "Sale saved locally while offline. It will sync automatically when you are back online.");
      setFirstSalePrompt(false);
      setLineItems([]);
      setBarcodeInput("");
      setSelectedProduct("");
      setSelectedCustomerId("");
      setQty("1");
      resetPaymentForm();
      setAddOpen(false);
      setSaving(false);
      return;
    }

    let createdSale: Awaited<ReturnType<typeof createSaleApi>>;
    try {
      createdSale = await createSaleApi(apiPayload);
    } catch (e) {
      if (canQueueOfflineAction() && method !== "Credit" && !invoiceMode) {
        createOfflineSale();
        addToOfflineQueue({ type: "sale", payload: offlinePayload });
        toast.success("Sale saved locally. It will sync automatically when you are back online.");
      } else {
        toast.error(e instanceof Error ? e.message : "Could not record sale");
      }
      setSaving(false);
      return;
    }

    saleIntegrationIdRef.current = null;
    toast.success(invoiceMode ? (createdSale.invoice_number ? `Invoice ${createdSale.invoice_number} created.` : "Invoice created.") : firstSalePrompt ? "Your first sale is recorded. Ready for daily sales." : "Sale recorded");
    setFirstSalePrompt(false);
    setInvoiceMode(false);
    setLineItems([]);
    setBarcodeInput("");
    setSelectedProduct("");
    setSelectedCustomerId("");
    setQty("1");
    resetPaymentForm();
    setAddOpen(false);

    try {
      await refreshUser();
    } catch (error) {
      toast.error(error instanceof Error
        ? `Sale recorded, but the latest data could not be refreshed: ${error.message}`
        : "Sale recorded, but the latest data could not be refreshed. Reload the page.");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenTill = async () => {
    const openingCash = Number(tillForm.openingCash);
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      toast.error("Enter a valid opening cash amount.");
      return;
    }
    try {
      const opened = await openTillApi({
        branch: till?.branch ?? (selectedBranchId ? Number(selectedBranchId) : null),
        cashier_name: tillForm.cashier,
        opening_cash: tillForm.openingCash || "0",
      });
      setTill(opened);
      setTillHistory((current) => [opened, ...current.filter((session) => session.id !== opened.id)]);
      setTillOpen(false);
      toast.success("Till opened");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open till");
    }
  };

  const handleCloseTill = async () => {
    if (!till) return;
    const closingCash = Number(tillForm.closingCash);
    if (tillForm.closingCash.trim() === "" || !Number.isFinite(closingCash) || closingCash < 0) {
      toast.error("Enter the actual cash counted to close this till.");
      return;
    }
    try {
      const closed = await closeTillApi(till.id, { closing_cash: tillForm.closingCash, notes: tillForm.notes.trim() });
      setTill(null);
      setTillHistory((current) => [closed, ...current.filter((session) => session.id !== closed.id)]);
      setTillOpen(false);
      toast.success(`Till closed. Variance: ${sym}${Number(closed.cash_variance).toLocaleString()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not close till");
    }
  };

  const handleRecordTillMovement = async () => {
    if (!till || savingTillMovement) return;
    const isCashExpense = tillMovementForm.movementType === "cash_expense";
    const amount = Number(tillMovementForm.amount);
    if (isCashExpense && !tillMovementForm.expense) {
      toast.error("Choose a recorded cash expense.");
      return;
    }
    if (!isCashExpense && (!Number.isFinite(amount) || amount <= 0)) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    setSavingTillMovement(true);
    tillMovementKeyRef.current ||= crypto.randomUUID();
    try {
      await createTillCashMovementApi(till.id, {
        movement_type: tillMovementForm.movementType,
        ...(isCashExpense ? { expense: Number(tillMovementForm.expense) } : { amount: tillMovementForm.amount }),
        note: tillMovementForm.note.trim(),
        idempotency_key: tillMovementKeyRef.current,
      });
      const refreshedTill = await getCurrentTillApi();
      setTill(refreshedTill);
      setTillMovementForm({ movementType: "withdrawal", amount: "", expense: "", note: "" });
      tillMovementKeyRef.current = null;
      toast.success("Till cash movement recorded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record this till movement.");
    } finally {
      setSavingTillMovement(false);
    }
  };

  const handleReviewTill = async () => {
    if (!reviewDialogSession) return;
    setTillReviewSaving(true);
    try {
      const reviewed = await reviewTillApi(reviewDialogSession.id, { note: tillReviewNote.trim() });
      setTillHistory((current) => current.map((session) => session.id === reviewed.id ? reviewed : session));
      setReviewDialogSession(null);
      setTillReviewNote("");
      toast.success("Till reconciliation reviewed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review this till session.");
    } finally {
      setTillReviewSaving(false);
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
        receipt.branch ? `Branch: ${receipt.branch}` : "",
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
      setReceiptSaleId(id);
      setReceiptPhone(receipt.customer_phone || "");
      setReceiptOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load receipt");
    }
  };

  const shareReceiptOnWhatsApp = async () => {
    if (!receiptSaleId) return;
    try {
      const payload = await fetchWhatsAppReceiptApi(receiptSaleId, {
        phone: receiptPhone,
        message: receiptText,
      });
      window.open(payload.whatsapp_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not prepare WhatsApp receipt");
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: "Today's Sales", value: `${sym}${todayTotal.toLocaleString()}`, change: salesChangeLabel, trend: previousDayTotal === 0 ? "neutral" : todayTotal >= previousDayTotal ? "positive" : "negative" },
          { label: "Transactions", value: String(todayCount), change: transactionChangeLabel, trend: previousDaySales.length === 0 ? "neutral" : todayCount >= previousDaySales.length ? "positive" : "negative" },
          { label: "Avg. Transaction", value: `${sym}${todayCount > 0 ? Math.round(todayTotal / todayCount) : 0}`, change: "Today's average", trend: "neutral" },
        ].map((m) => (
          <Card key={m.label} className="shadow-soft">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-xl font-display font-bold mt-1">{m.value}</p>
              <span className={`text-xs flex items-center gap-0.5 mt-1 ${m.trend === "positive" ? "text-success" : m.trend === "negative" ? "text-destructive" : "text-muted-foreground"}`}>
                {m.trend === "positive" ? <ArrowUpRight className="h-3 w-3" /> : m.trend === "negative" ? <ArrowDownRight className="h-3 w-3" /> : null}
                {m.change}
              </span>
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
                <p className="text-xs text-muted-foreground">{till ? `Expected cash: ${sym}${Number(till.expected_cash).toLocaleString()} · sales ${sym}${Number(till.cash_sales || 0).toLocaleString()} · expenses ${sym}${Number(till.cash_expenses || 0).toLocaleString()} · withdrawals ${sym}${Number(till.cash_withdrawals || 0).toLocaleString()}` : "Open a till to track cash variance for the shift."}</p>
              </div>
            </div>
            <Button variant={till ? "outline" : "default"} onClick={() => setTillOpen(true)}>{till ? "Close Till" : "Open Till"}</Button>
          </CardContent>
        </Card>

      <Card className="shadow-soft">
        <CardHeader className="pb-3"><CardTitle className="font-display text-base">Till history</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {tillHistoryError ? <p role="alert" className="text-sm text-destructive">{tillHistoryError}</p> : null}
          {tillHistory.slice(0, 10).map((session) => (
            <div key={session.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">{session.cashier_name || "Till session"} · {session.status}</p>
                <p className="text-xs text-muted-foreground">Opened {new Date(session.opened_at).toLocaleString()} · opening {sym}{Number(session.opening_cash).toLocaleString()}</p>
                {session.status === "closed" ? <p className="mt-1 text-xs text-muted-foreground">Expected {sym}{Number(session.expected_cash).toLocaleString()} · counted {sym}{Number(session.closing_cash).toLocaleString()} · variance <span className={Number(session.cash_variance) === 0 ? "text-success" : "text-destructive"}>{sym}{Number(session.cash_variance).toLocaleString()}</span></p> : null}
                {session.notes ? <p className="mt-1 text-xs text-muted-foreground">Closing note: {session.notes}</p> : null}
                {session.reviewed_at ? <p className="mt-1 text-xs text-success">Reviewed by {session.reviewer_name || "manager"} · {new Date(session.reviewed_at).toLocaleString()}{session.review_note ? ` · ${session.review_note}` : ""}</p> : null}
              </div>
              {session.status === "closed" && !session.reviewed_at && canReviewTills ? <Button size="sm" variant="outline" onClick={() => { setReviewDialogSession(session); setTillReviewNote(""); }}>Review</Button> : null}
            </div>
          ))}
          {!tillHistoryError && tillHistory.length === 0 ? <p className="text-sm text-muted-foreground">No till sessions have been recorded yet.</p> : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search sales..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {canUseMultiBranch && branches.length > 0 ? (
          <select aria-label="Sales branch filter" value={salesBranchFilter} onChange={(event) => setSalesBranchFilter(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="all">All branches</option>
            <option value="unassigned">No branch</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        ) : null}
        <Button onClick={() => setAddOpen(true)} className="bg-gradient-hero text-primary-foreground"><Plus className="h-4 w-4 mr-2" /> Record Sale</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="No sales yet"
          description={products.length === 0 ? "Add your first product before recording a sale. Your stock and prices will be ready to select here." : "Choose a product, add the quantity and record your first sale."}
          actionLabel={products.length === 0 ? "Add Your First Product" : "Record Sale"}
          onAction={() => products.length === 0 ? navigate("/inventory") : setAddOpen(true)}
        />
      ) : (
        <Card className="shadow-soft">
          <CardHeader className="pb-2"><CardTitle className="text-base font-display">Transactions</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {filtered.map((s, i) => (
                <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors group">
                  <button type="button" onClick={() => showReceipt(s.id)} className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{s.items}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{s.time} · {s.date} · {s.method}</span>
                        {s.branchId ? <span>{branches.find((branch) => branch.id === s.branchId)?.name || "Branch"}</span> : null}
                        {s.paymentCurrency ? <span className="rounded border border-border px-2 py-0.5">{s.paymentCurrency}</span> : null}
                      </div>
                      {s.paymentAllocations?.length && s.paymentAllocations.length > 1 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Split: {s.paymentAllocations.map((row) => `${symbolForCurrency(row.currency)}${row.amount.toLocaleString()} ${row.currency}`).join(" + ")}
                        </p>
                      ) : null}
                    </div>
                    <p className="shrink-0 font-display font-bold">{sym}{s.total.toLocaleString()}</p>
                  </button>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label="View receipt" onClick={() => showReceipt(s.id)} className="p-1.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"><Receipt className="h-3.5 w-3.5 text-muted-foreground" /></button>
                    <button type="button" aria-label="Delete sale" onClick={() => setDeleteId(s.id)} className="p-1.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) { setFirstSalePrompt(false); setInvoiceMode(false); } }}>
        <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle className="font-display">{invoiceMode ? "Create customer invoice" : "Record Sale"}</DialogTitle>
            <DialogDescription>
              {invoiceMode
                ? "Choose a saved customer and add the items. Verifin will issue an invoice number when you record the sale."
                : firstSalePrompt
                ? "You’re ready for your first sale. Choose a product, enter the quantity, and save."
                : "Add products, choose payment currency, and save the sale total in your base currency."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {canUseMultiBranch && branches.length > 0 ? (
              <div>
                <Label>Branch</Label>
                <select value={selectedBranchId} onChange={(event) => { setSelectedBranchId(event.target.value); setLineItems([]); setSelectedProduct(""); }} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">No branch</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.isPrimary ? " (Primary)" : ""}</option>)}
                </select>
              </div>
            ) : null}
            {availableProducts.length > 0 ? (
              <div>
                <Label>Quick add a product</Label>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {availableProducts.slice(0, 6).map((product) => (
                    <Button
                      key={product.id}
                      type="button"
                      variant={selectedProduct === product.id ? "default" : "outline"}
                      className="h-auto min-h-14 justify-between gap-2 whitespace-normal px-3 py-2 text-left"
                      onClick={() => setSelectedProduct(product.id)}
                    >
                      <span className="min-w-0 truncate">{product.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{sym}{Number(product.price).toLocaleString()}</span>
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
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
                  {availableProducts.map(p => (
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

            <div>
              <Label>Customer{invoiceMode ? " (required for invoice)" : ""}</Label>
              <select
                value={selectedCustomerId}
                onChange={e => setSelectedCustomerId(e.target.value)}
                required={invoiceMode}
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{invoiceMode ? "Select a customer..." : "Walk-in customer"}</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}{customer.phone ? ` · ${customer.phone}` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                {invoiceMode
                  ? "The invoice will include this customer's name and saved contact number."
                  : "Select a saved customer to include their details on the invoice and receipt."}
              </p>
            </div>

            {lineItems.length > 0 && (
              <div className="border border-border rounded-lg divide-y divide-border">
                {lineItems.map((item, idx) => (
                  <div key={idx} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{item.quantity}x {item.productName}</span>
                      <span className="text-muted-foreground ml-2">@ {sym}{item.unitPrice}</span>
                      {item.discountAmount > 0 ? <p className="text-xs text-muted-foreground">Discount: {sym}{item.discountAmount} per item</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-24">
                        <Label className="text-[11px]">Discount / item</Label>
                        <Input
                          type="number"
                          min="0"
                          max={item.unitPrice}
                          step="0.01"
                          value={item.discountAmount}
                          onChange={(event) => {
                            const discountAmount = Math.min(item.unitPrice, Math.max(0, Number(event.target.value) || 0));
                            setLineItems((items) => items.map((line, index) => index === idx ? { ...line, discountAmount } : line));
                          }}
                          className="h-8"
                        />
                      </div>
                      <span className="font-display font-semibold">{sym}{(item.quantity * (item.unitPrice - item.discountAmount)).toLocaleString()}</span>
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
              <select value={method} onChange={e => {
                const nextMethod = e.target.value as "Cash" | "EFT" | "Card" | "Credit";
                if (nextMethod === "Credit" && !canUse("customer_credit")) {
                  promptUpgrade("customer_credit", "Customer credit");
                  return;
                }
                setMethod(nextMethod);
              }} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="Cash">Cash</option>
                <option value="EFT">EFT</option>
                <option value="Card">Card</option>
                <option value="Credit">Credit / pay later</option>
              </select>
            </div>

            {method === "Credit" ? (
              <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                <div>
                  <Label>Amount received now ({baseCurrency})</Label>
                  <Input type="number" min="0" max={saleTotal} step="0.01" value={creditPaidAmount} onChange={e => setCreditPaidAmount(e.target.value)} className="mt-1" />
                </div>
                {Number(creditPaidAmount) > 0 && (
                  <div>
                    <Label>Payment Method</Label>
                    <select value={creditPaymentMethod} onChange={e => setCreditPaymentMethod(e.target.value as "Cash" | "EFT" | "Card")} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                      <option value="Cash">Cash</option><option value="EFT">EFT</option><option value="Card">Card</option>
                    </select>
                  </div>
                )}
                <div>
                  <Label>Due Date (optional)</Label>
                  <Input type="date" value={creditDueDate} onChange={e => setCreditDueDate(e.target.value)} className="mt-1" />
                </div>
                <p className="text-sm font-medium">Outstanding after payment: {sym}{Math.max(0, saleTotal - (Number(creditPaidAmount) || 0)).toFixed(2)}</p>
              </div>
            ) : null}

            {method !== "Credit" && <div>
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
            </div>}

            <div>
              <Label>Financial account (optional)</Label>
              <select
                value={availablePaymentAccounts.some((account) => String(account.id) === paymentAccountId) ? paymentAccountId : ""}
                onChange={(event) => setPaymentAccountId(event.target.value)}
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Do not post to an account ledger</option>
                {availablePaymentAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">Choose where this payment was received. Account currency must match the payment currency.</p>
            </div>

            {method !== "Credit" && paymentCurrency !== baseCurrency ? (
              <div>
                <Label>Exchange Rate ({paymentCurrency} to {baseCurrency})</Label>
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
                    <Label>Exchange Rate ({alternateCurrency} to {baseCurrency})</Label>
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

            {method !== "Credit" && <div className="rounded-md bg-muted/50 px-3 py-2 text-sm space-y-1">
              <p>Sale total in {baseCurrency}: {sym}{saleTotal.toLocaleString()}</p>
              {splitAmountValue > 0 && alternateCurrency ? <p>Split in {alternateCurrency}: {symbolForCurrency(alternateCurrency)}{splitAmountValue.toLocaleString()} ({sym}{splitBasePreview.toLocaleString()} base)</p> : null}
              {saleTotal > 0 ? <p>Remaining in {paymentCurrency}: {symbolForCurrency(paymentCurrency)}{primaryAmountPreview.toLocaleString()}</p> : null}
            </div>}

            <Button onClick={handleAdd} disabled={lineItems.length === 0 || saving} className="w-full bg-gradient-hero text-primary-foreground">
              {saving ? "Saving..." : `Record Sale - ${sym}${saleTotal.toLocaleString()}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleBarcodeDetected} />
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
                  <div><Label>Cashier Name</Label><Input value={tillForm.cashier} onChange={e => setTillForm({ ...tillForm, cashier: e.target.value })} className="mt-1" /></div>
                  <div><Label>Opening Cash ({sym})</Label><Input type="number" min="0" step="0.01" value={tillForm.openingCash} onChange={e => setTillForm({ ...tillForm, openingCash: e.target.value })} className="mt-1" /></div>
                  <Button onClick={handleOpenTill} className="w-full">Open Till</Button>
                </>
              ) : (
                <>
                  <div className="rounded-lg bg-muted/40 p-3 text-sm">
                    <p>Opening cash: {sym}{Number(till.opening_cash).toLocaleString()}</p>
                    <p>Cash sales (after refunds): {sym}{Number(till.cash_sales || 0).toLocaleString()}</p>
                    <p>Cash expenses: −{sym}{Number(till.cash_expenses || 0).toLocaleString()}</p>
                    <p>Withdrawals: −{sym}{Number(till.cash_withdrawals || 0).toLocaleString()} · Cash added: {sym}{Number(till.cash_deposits || 0).toLocaleString()}</p>
                    <p className="mt-1 font-semibold">Expected cash: {sym}{Number(till.expected_cash).toLocaleString()}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">Card: {sym}{Number(till.card_sales_total || 0).toLocaleString()} · EFT: {sym}{Number(till.eft_sales_total || 0).toLocaleString()}</p>
                  <div className="space-y-3 rounded-lg border p-3">
                    <p className="text-sm font-medium">Record cash movement</p>
                    <div>
                      <Label>Movement type</Label>
                      <select value={tillMovementForm.movementType} onChange={(event) => setTillMovementForm({ ...tillMovementForm, movementType: event.target.value as ApiTillCashMovement["movement_type"], amount: "", expense: "" })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                        <option value="withdrawal">Cash withdrawal</option>
                        <option value="deposit">Cash added</option>
                        <option value="cash_expense">Link recorded cash expense</option>
                      </select>
                    </div>
                    {tillMovementForm.movementType === "cash_expense" ? (
                      <div>
                        <Label>Cash expense</Label>
                        <select value={tillMovementForm.expense} onChange={(event) => setTillMovementForm({ ...tillMovementForm, expense: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                          <option value="">Choose an unlinked cash expense</option>
                          {eligibleTillExpenses.map((expense) => <option key={expense.id} value={expense.id}>{expense.description} · {new Date(`${expense.date}T12:00:00`).toLocaleDateString()} · {sym}{Number(expense.amount_base ?? expense.amount).toFixed(2)}</option>)}
                        </select>
                        {tillExpensesError ? <p role="alert" className="mt-1 text-xs text-destructive">{tillExpensesError}</p> : null}
                        {!tillExpensesError && eligibleTillExpenses.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No unlinked cash expenses for this till branch. Record the expense in Expenses first.</p> : null}
                      </div>
                    ) : (
                      <div><Label>Amount ({sym})</Label><Input type="number" min="0.01" step="0.01" value={tillMovementForm.amount} onChange={(event) => setTillMovementForm({ ...tillMovementForm, amount: event.target.value })} className="mt-1" /></div>
                    )}
                    <div><Label>Note (optional)</Label><Input maxLength={255} value={tillMovementForm.note} onChange={(event) => setTillMovementForm({ ...tillMovementForm, note: event.target.value })} className="mt-1" /></div>
                    <Button variant="outline" className="w-full" onClick={() => void handleRecordTillMovement()} disabled={savingTillMovement || (tillMovementForm.movementType === "cash_expense" && !tillMovementForm.expense)}>{savingTillMovement ? "Recording…" : "Record cash movement"}</Button>
                  </div>
                  {till.cash_movements?.length ? <div className="space-y-2"><p className="text-sm font-medium">Cash movement history</p>{till.cash_movements.map((movement) => <div key={movement.id} className="flex items-start justify-between gap-3 rounded-md border p-2 text-xs"><span>{movement.movement_type.replace("_", " ")} · {movement.expense_description || movement.note || "No note"}</span><span className="shrink-0">{sym}{Number(movement.amount).toFixed(2)}</span></div>)}</div> : null}
                  <div><Label>Actual Cash Counted ({sym})</Label><Input type="number" min="0" step="0.01" value={tillForm.closingCash} onChange={e => setTillForm({ ...tillForm, closingCash: e.target.value })} className="mt-1" /></div>
                  <div><Label>Closing Notes</Label><Input maxLength={2000} value={tillForm.notes} onChange={e => setTillForm({ ...tillForm, notes: e.target.value })} className="mt-1" placeholder="Explain any cash difference" /></div>
                  <Button onClick={handleCloseTill} disabled={!tillForm.closingCash.trim()} className="w-full">Close Till</Button>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

      <Dialog open={!!reviewDialogSession} onOpenChange={(open) => { if (!open) setReviewDialogSession(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Review till reconciliation</DialogTitle>
            <DialogDescription>Confirm the cash count and variance before marking this session reviewed.</DialogDescription>
          </DialogHeader>
          {reviewDialogSession ? <div className="space-y-2 rounded-md bg-muted/50 p-3 text-sm">
            <p>Expected: {sym}{Number(reviewDialogSession.expected_cash).toLocaleString()}</p>
            <p>Counted: {sym}{Number(reviewDialogSession.closing_cash).toLocaleString()}</p>
            <p>Variance: {sym}{Number(reviewDialogSession.cash_variance).toLocaleString()}</p>
          </div> : null}
          <div><Label>Review note (optional)</Label><Input maxLength={255} value={tillReviewNote} onChange={(event) => setTillReviewNote(event.target.value)} className="mt-1" /></div>
          <Button onClick={() => void handleReviewTill()} disabled={tillReviewSaving}>{tillReviewSaving ? "Saving review…" : "Confirm review"}</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle className="font-display">Receipt</DialogTitle>
            <DialogDescription>
              Reprint, copy, or share this receipt with the customer.
            </DialogDescription>
          </DialogHeader>
          <pre className="rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap">{receiptText}</pre>
          <div>
            <Label>WhatsApp Number</Label>
            <Input
              className="mt-1"
              value={receiptPhone}
              onChange={e => setReceiptPhone(e.target.value)}
              placeholder="Leave blank to choose contact in WhatsApp"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button>
            <Button variant="outline" onClick={() => navigator.clipboard.writeText(receiptText)}>Copy Receipt</Button>
            <Button className="sm:col-span-2" onClick={() => void shareReceiptOnWhatsApp()}>
              <MessageCircle className="mr-2 h-4 w-4" />
              WhatsApp Receipt
            </Button>
          </div>
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
