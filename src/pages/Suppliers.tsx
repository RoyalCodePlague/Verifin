import { useAuth } from "@/lib/auth-context";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, PackagePlus, Plus, RotateCcw, ShoppingBag, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SupplyInvoiceWorkspace } from "@/components/invoices/SupplyInvoiceWorkspace";
import {
  createPurchaseOrderApi,
  createGoodsReceivedNoteApi,
  confirmGoodsReceivedNoteApi,
  attachGoodsReceivedDocumentApi,
  createSupplierReturnApi,
  createSupplierPaymentApi,
  createSupplierApi,
  fetchSupplierHistoryApi,
  fetchSupplierStatementApi,
  fetchPurchaseSuggestions,
  fetchSmartReorderApi,
  fetchSupplierScorecardsApi,
  listSupplierPaymentBalancesApi,
  listSupplierPaymentsApi,
  listGoodsReceivedNotesApi,
  listFinancialAccountsApi,
  listPurchaseOrdersApi,
  listSuppliersApi,
  transitionPurchaseOrderApi,
  type ApiPurchaseOrder,
  type ApiGoodsReceivedNote,
  type ApiGoodsReceivedNoteItem,
  type ApiSupplierBalance,
  type ApiSupplierOverdueInvoice,
  type ApiSupplierPayment,
  type ApiFinancialAccount,
  type ApiSupplier,
  type ApiSupplierStatement,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { symbolForCurrency } from "@/lib/currency";
import { addToOfflineQueue, canQueueOfflineAction } from "@/lib/offlineQueue";

type Suggestion = Awaited<ReturnType<typeof fetchPurchaseSuggestions>>["items"][number];
type SmartReorderItem = Awaited<ReturnType<typeof fetchSmartReorderApi>>["items"][number];
type SupplierScorecard = Awaited<ReturnType<typeof fetchSupplierScorecardsApi>>["items"][number];

const emptySupplier = {
  name: "",
  contact_name: "",
  phone: "",
  email: "",
  invoice_email: "",
  address: "",
  tax_number: "",
  notes: "",
  lead_time_days: 7,
  payment_terms_days: 14,
};
const SUPPLIERS_CACHE_KEY = "sp_suppliers_cache";
const PURCHASE_ORDERS_CACHE_KEY = "sp_purchase_orders_cache";
const PURCHASE_SUGGESTIONS_CACHE_KEY = "sp_purchase_suggestions_cache";
const SMART_REORDER_CACHE_KEY = "sp_smart_reorder_cache";
const SUPPLIER_SCORECARDS_CACHE_KEY = "sp_supplier_scorecards_cache";

type PurchaseOrderDraftLine = { product: string; quantity: string; unitCost: string };
type ReceiptDraftLine = {
  purchaseOrderItem: number;
  quantity: string;
  damaged: string;
  missing: string;
  unitCost: string;
  batchNumber: string;
  expiryDate: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function timeNow() {
  return new Date().toTimeString().slice(0, 5);
}

function prettyDate(date: string) {
  if (!date) return "Not set";
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function prettyDateTime(iso: string) {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function readCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeCache(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

const Suppliers = () => {
  const { refreshUser } = useAuth();
  const supplyRequestId = useRef(crypto.randomUUID());
  const supplierPaymentRequestKey = useRef<string | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);
  const { products, profile, supplyEntries, addSupplyEntry } = useStore();
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [orders, setOrders] = useState<ApiPurchaseOrder[]>([]);
  const [goodsReceivedNotes, setGoodsReceivedNotes] = useState<ApiGoodsReceivedNote[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [smartReorders, setSmartReorders] = useState<SmartReorderItem[]>([]);
  const [scorecards, setScorecards] = useState<SupplierScorecard[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<ApiSupplierPayment[]>([]);
  const [financialAccounts, setFinancialAccounts] = useState<ApiFinancialAccount[]>([]);
  const [supplierBalances, setSupplierBalances] = useState<ApiSupplierBalance[]>([]);
  const [overdueInvoices, setOverdueInvoices] = useState<ApiSupplierOverdueInvoice[]>([]);
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    purchaseOrder: "",
    amount: "",
    currency: profile.currency,
    paymentDate: todayIso(),
    method: "bank" as ApiSupplierPayment["method"],
    financialAccountId: "",
    reference: "",
    notes: "",
  });
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [receivingOrder, setReceivingOrder] = useState<ApiPurchaseOrder | null>(null);
  const [receiptLines, setReceiptLines] = useState<ReceiptDraftLine[]>([]);
  const [receiptDate, setReceiptDate] = useState(todayIso());
  const [receiptNotes, setReceiptNotes] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptDraftId, setReceiptDraftId] = useState<number | null>(null);
  const [receiptIdempotencyKey, setReceiptIdempotencyKey] = useState("");
  const [receiptDocumentAttached, setReceiptDocumentAttached] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [supplierHistory, setSupplierHistory] = useState<Awaited<ReturnType<typeof fetchSupplierHistoryApi>> | null>(null);
  const [supplierHistoryOpen, setSupplierHistoryOpen] = useState(false);
  const [supplierStatement, setSupplierStatement] = useState<ApiSupplierStatement | null>(null);
  const [supplierStatementOpen, setSupplierStatementOpen] = useState(false);
  const [loadingSupplierStatement, setLoadingSupplierStatement] = useState(false);
  const [returnNote, setReturnNote] = useState<ApiGoodsReceivedNote | null>(null);
  const [returnReason, setReturnReason] = useState<"damaged" | "incorrect" | "expired" | "excess" | "other">("damaged");
  const [returnQuantities, setReturnQuantities] = useState<Record<number, { accepted: string; damaged: string }>>({});
  const [returnIdempotencyKey, setReturnIdempotencyKey] = useState("");
  const [savingReturn, setSavingReturn] = useState(false);
  const [activeTab, setActiveTab] = useState("log");
  const [supplierForm, setSupplierForm] = useState(emptySupplier);
  const [entryForm, setEntryForm] = useState({
    direction: "incoming" as "incoming" | "outgoing",
    paymentStatus: "paid" as "pending" | "partial" | "paid",
    partnerName: "",
    partnerCategory: "supplier" as "supplier" | "customer" | "shop" | "company" | "other",
    productId: "",
    quantity: "1",
    currency: profile.currency,
    fxRate: "",
    unitPrice: "",
    unitCost: "",
    movementDate: todayIso(),
    movementTime: timeNow(),
    notes: "",
  });
  const [orderForm, setOrderForm] = useState({
    supplier: "",
    items: [{ product: "", quantity: "1", unitCost: "" }] as PurchaseOrderDraftLine[],
    currency: profile.currency,
    fxRate: "",
    expectedDate: "",
    supplierInvoiceNumber: "",
    invoiceDate: "",
    dueDate: "",
    discountAmount: "0",
    additionalCharges: "0",
  });
  const sym = profile.currencySymbol || "R";
  const enabledCurrencies = profile.enabledCurrencies?.length ? profile.enabledCurrencies : [profile.currency];
  const eligiblePaymentAccounts = financialAccounts.filter((account) => account.is_active
    && account.currency.toUpperCase() === paymentForm.currency.toUpperCase()
    && account.opening_date <= paymentForm.paymentDate);

  useEffect(() => {
    listFinancialAccountsApi().then((accounts) => setFinancialAccounts(accounts.filter((account) => account.is_active)))
      .catch(() => setFinancialAccounts([]));
  }, []);

  const loadData = async () => {
    if (!navigator.onLine) {
      setSuppliers(readCache<ApiSupplier[]>(SUPPLIERS_CACHE_KEY, []));
      setOrders(readCache<ApiPurchaseOrder[]>(PURCHASE_ORDERS_CACHE_KEY, []));
      setGoodsReceivedNotes([]);
      setSuggestions(readCache<Suggestion[]>(PURCHASE_SUGGESTIONS_CACHE_KEY, []));
      setSmartReorders(readCache<SmartReorderItem[]>(SMART_REORDER_CACHE_KEY, []));
      setScorecards(readCache<SupplierScorecard[]>(SUPPLIER_SCORECARDS_CACHE_KEY, []));
      setSupplierPayments([]);
      setSupplierBalances([]);
      setOverdueInvoices([]);
      return;
    }
    const [nextSuppliers, nextOrders, nextNotes, nextSuggestions, nextSmartReorders, nextScorecards, nextSupplierPayments, nextSupplierBalances] = await Promise.all([
      listSuppliersApi(),
      listPurchaseOrdersApi(),
      listGoodsReceivedNotesApi(),
      fetchPurchaseSuggestions(7),
      fetchSmartReorderApi().catch(() => ({ items: [] })),
      fetchSupplierScorecardsApi().catch(() => ({ items: [] })),
      listSupplierPaymentsApi(),
      listSupplierPaymentBalancesApi(),
    ]);
    setSuppliers(nextSuppliers);
    setOrders(nextOrders);
    setGoodsReceivedNotes(nextNotes);
    setSuggestions(nextSuggestions.items);
    setSmartReorders(nextSmartReorders.items);
    setScorecards(nextScorecards.items);
    setSupplierPayments(nextSupplierPayments);
    setSupplierBalances(nextSupplierBalances.items);
    setOverdueInvoices(nextSupplierBalances.overdue_invoices || []);
    writeCache(SUPPLIERS_CACHE_KEY, nextSuppliers);
    writeCache(PURCHASE_ORDERS_CACHE_KEY, nextOrders);
    writeCache(PURCHASE_SUGGESTIONS_CACHE_KEY, nextSuggestions.items);
    writeCache(SMART_REORDER_CACHE_KEY, nextSmartReorders.items);
    writeCache(SUPPLIER_SCORECARDS_CACHE_KEY, nextScorecards.items);
  };

  useEffect(() => {
    loadData().catch(() => {
      setSuppliers(readCache<ApiSupplier[]>(SUPPLIERS_CACHE_KEY, []));
      setOrders(readCache<ApiPurchaseOrder[]>(PURCHASE_ORDERS_CACHE_KEY, []));
      setGoodsReceivedNotes([]);
      setSuggestions(readCache<Suggestion[]>(PURCHASE_SUGGESTIONS_CACHE_KEY, []));
      setSmartReorders(readCache<SmartReorderItem[]>(SMART_REORDER_CACHE_KEY, []));
      setScorecards(readCache<SupplierScorecard[]>(SUPPLIER_SCORECARDS_CACHE_KEY, []));
      setSupplierPayments([]);
      setSupplierBalances([]);
      setOverdueInvoices([]);
    });
  }, []);

  useEffect(() => {
    setOrderForm((current) => ({ ...current, currency: profile.currency }));
    setPaymentForm((current) => ({ ...current, currency: profile.currency }));
  }, [profile.currency]);

  const saveSupplierPayment = async () => {
    const order = orders.find((item) => String(item.id) === paymentForm.purchaseOrder);
    const amount = Number(paymentForm.amount);
    if (!order || !Number.isFinite(amount) || amount <= 0 || !paymentForm.paymentDate) {
      toast.error("Choose a received purchase order, enter a valid payment amount, and select the payment date.");
      return;
    }
    setSavingPayment(true);
    try {
      const payment = await createSupplierPaymentApi({
        supplier: order.supplier,
        purchase_order: order.id,
        amount,
        currency: paymentForm.currency || profile.currency,
        financial_account: paymentForm.financialAccountId && eligiblePaymentAccounts.some((account) => String(account.id) === paymentForm.financialAccountId)
          ? Number(paymentForm.financialAccountId)
          : null,
        payment_date: paymentForm.paymentDate,
        method: paymentForm.method,
        reference: paymentForm.reference.trim(),
        notes: paymentForm.notes.trim(),
        idempotency_key: supplierPaymentRequestKey.current || (supplierPaymentRequestKey.current = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      });
      supplierPaymentRequestKey.current = null;
      setSupplierPayments((current) => [payment, ...current]);
      setPaymentForm((current) => ({ ...current, amount: "", reference: "", notes: "" }));
      await loadData();
      toast.success("Supplier payment recorded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record supplier payment");
    } finally {
      setSavingPayment(false);
    }
  };

  useEffect(() => {
    setEntryForm((current) => ({
      ...current,
      currency: current.currency || profile.currency,
      fxRate: current.currency === profile.currency ? "" : current.fxRate,
    }));
  }, [profile.currency]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === entryForm.productId),
    [entryForm.productId, products]
  );
  const inboundEntries = supplyEntries.filter((entry) => entry.direction === "incoming");
  const outboundEntries = supplyEntries.filter((entry) => entry.direction === "outgoing");
  const totalIncomingUnits = inboundEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const totalOutgoingUnits = outboundEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const entryCurrency = entryForm.currency || profile.currency;
  const entryCurrencySymbol = symbolForCurrency(entryCurrency);
  const entryFxRate = entryCurrency === profile.currency
    ? 1
    : (Number(entryForm.fxRate) || profile.exchangeRates?.[entryCurrency] || 0);
  const entryTotalValue = (Number(entryForm.quantity) || 0) * (Number(entryForm.unitPrice) || 0);
  const entryTotalCost = (Number(entryForm.quantity) || 0) * (Number(entryForm.unitCost) || 0);
  const entryTotalBaseValue = entryTotalValue * entryFxRate;

  const saveSupplier = async () => {
    if (canQueueOfflineAction()) {
      const localSupplier = { ...supplierForm, id: -Date.now() } as ApiSupplier;
      setSuppliers((prev) => {
        const next = [localSupplier, ...prev];
        writeCache(SUPPLIERS_CACHE_KEY, next);
        return next;
      });
      addToOfflineQueue({ type: "supplier_create", payload: supplierForm });
      setSupplierForm(emptySupplier);
      setSupplierOpen(false);
      toast.success("Supplier saved locally. It will sync when you are back online.");
      return;
    }
    try {
      const created = await createSupplierApi(supplierForm);
      setSuppliers((prev) => {
        const next = [created, ...prev];
        writeCache(SUPPLIERS_CACHE_KEY, next);
        return next;
      });
      setSupplierForm(emptySupplier);
      setSupplierOpen(false);
      toast.success("Supplier added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add supplier");
    }
  };

  const saveEntry = async () => {
    if (savingEntry) return;
    const quantity = Number(entryForm.quantity) || 0;
    const unitPrice = Number(entryForm.unitPrice) || 0;
    const unitCost = Number(entryForm.unitCost) || 0;
    const fxRateToBase = entryForm.currency === profile.currency
      ? 1
      : (Number(entryForm.fxRate) || profile.exchangeRates?.[entryForm.currency] || 0);

    if (entryForm.currency !== profile.currency && fxRateToBase <= 0) {
      toast.error(`Enter a valid rate for ${entryForm.currency}`);
      return;
    }

    setSavingEntry(true);
    const result = await addSupplyEntry({
      requestId: supplyRequestId.current,
      direction: entryForm.direction,
      paymentStatus: entryForm.paymentStatus,
      partnerName: entryForm.partnerName.trim(),
      partnerCategory: entryForm.partnerCategory,
      productId: entryForm.productId,
      productName: selectedProduct?.name || "",
      quantity,
      unitPrice,
      unitCost,
      currency: entryForm.currency,
      fxRateToBase,
      movementDate: entryForm.movementDate || todayIso(),
      movementTime: entryForm.movementTime || timeNow(),
      notes: entryForm.notes.trim(),
    });

    setSavingEntry(false);
    if (!result.ok) {
      toast.error(result.message || "Could not save this supply entry");
      return;
    }

    supplyRequestId.current = crypto.randomUUID();
    setEntryForm({
      direction: "incoming",
      paymentStatus: "paid",
      partnerName: "",
      partnerCategory: "supplier",
      productId: "",
      quantity: "1",
      currency: profile.currency,
      fxRate: "",
      unitPrice: "",
      unitCost: "",
      movementDate: todayIso(),
      movementTime: timeNow(),
      notes: "",
    });
    if (!canQueueOfflineAction()) {
      try { await refreshUser(); } catch { toast.warning("Supply saved. Refresh to reload the latest stock."); }
    }
    toast.success(result.entry?.direction === "incoming" ? "Supply received and inventory updated" : "Supply sale recorded and inventory updated");
    setActiveTab("invoices");
  };

  const createOrder = async () => {
    const items = orderForm.items.filter((item) => item.product);
    if (!orderForm.supplier || !items.length) return;
    const normalizedItems = items.map((item) => ({
      product: Number(item.product),
      quantity: Number(item.quantity),
      unitCost: item.unitCost.trim()
        ? Number(item.unitCost)
        : products.find((product) => product.id === item.product)?.costPrice || 0,
    }));
    if (normalizedItems.some((item) =>
      !Number.isInteger(item.quantity) || item.quantity <= 0
      || !Number.isFinite(item.unitCost) || item.unitCost < 0
    )) {
      toast.error("Enter a positive whole quantity and a valid non-negative unit cost for each product.");
      return;
    }
    try {
      const created = await createPurchaseOrderApi({
        supplier: Number(orderForm.supplier),
        branch: null,
        currency: orderForm.currency,
        fx_rate_to_base: orderForm.currency === profile.currency ? undefined : (Number(orderForm.fxRate) || profile.exchangeRates?.[orderForm.currency] || undefined),
        expected_date: orderForm.expectedDate || null,
        supplier_invoice_number: orderForm.supplierInvoiceNumber.trim(),
        invoice_date: orderForm.invoiceDate || null,
        due_date: orderForm.dueDate || null,
        discount_amount: orderForm.discountAmount,
        additional_charges: orderForm.additionalCharges,
        items: normalizedItems.map((item) => ({
          product: item.product,
          quantity_ordered: item.quantity,
          unit_cost: item.unitCost.toFixed(2),
        })),
      });
      setOrders((prev) => [created, ...prev]);
      setOrderOpen(false);
      setOrderForm({
        supplier: "",
        items: [{ product: "", quantity: "1", unitCost: "" }],
        currency: profile.currency,
        fxRate: "",
        expectedDate: "",
        supplierInvoiceNumber: "",
        invoiceDate: "",
        dueDate: "",
        discountAmount: "0",
        additionalCharges: "0",
      });
      toast.success("Draft purchase order created; no stock was changed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create purchase order");
    }
  };

  const openReceiveOrder = (order: ApiPurchaseOrder) => {
    setReceivingOrder(order);
    setReceiptLines(order.items.filter((item): item is typeof item & { id: number } => item.id !== undefined).map((item) => ({
      purchaseOrderItem: item.id,
      quantity: String(Math.max(item.quantity_ordered - (item.quantity_received || 0), 0)),
      damaged: "0",
      missing: "0",
      unitCost: item.unit_cost,
      batchNumber: "",
      expiryDate: "",
    })));
    setReceiptDate(todayIso());
    setReceiptNotes("");
    setReceiptFile(null);
    setReceiptDraftId(null);
    setReceiptIdempotencyKey(crypto.randomUUID());
    setReceiptDocumentAttached(false);
  };

  const resumeReceipt = (order: ApiPurchaseOrder, note: ApiGoodsReceivedNote) => {
    setReceivingOrder(order);
    setReceiptDraftId(note.id);
    setReceiptIdempotencyKey("");
    setReceiptDate(note.delivery_date);
    setReceiptNotes(note.notes);
    setReceiptFile(null);
    setReceiptDocumentAttached(note.attachments.length > 0);
    setReceiptLines(order.items
      .filter((item): item is typeof item & { id: number } => item.id !== undefined)
      .map((item) => {
        const saved = note.items.find((line) => line.purchase_order_item === item.id);
        return {
          purchaseOrderItem: item.id,
          quantity: String(saved?.quantity_delivered || 0),
          damaged: String(saved?.quantity_damaged || 0),
          missing: String(saved?.quantity_missing || 0),
          unitCost: saved?.unit_cost || item.unit_cost,
          batchNumber: saved?.batch_number || "",
          expiryDate: saved?.expiry_date || "",
        };
      }));
  };

  const receiveOrder = async () => {
    if (!receivingOrder || receiving) return;
    setReceiving(true);
    try {
      let noteId = receiptDraftId;
      if (noteId == null) {
        const draft = await createGoodsReceivedNoteApi(receivingOrder.id, {
          delivery_date: receiptDate,
          idempotency_key: receiptIdempotencyKey,
          notes: receiptNotes.trim(),
          items: receiptLines
            .filter((line) => Number(line.quantity) > 0 || Number(line.missing) > 0)
            .map((line) => ({
              purchase_order_item: line.purchaseOrderItem,
              quantity_delivered: Number(line.quantity) || 0,
              quantity_damaged: Number(line.damaged) || 0,
              quantity_missing: Number(line.missing) || 0,
              unit_cost: Number(line.unitCost).toFixed(2),
              batch_number: line.batchNumber.trim(),
              expiry_date: line.expiryDate || null,
            })),
        });
        noteId = draft.id;
        setReceiptDraftId(noteId);
      }
      if (receiptFile && !receiptDocumentAttached) {
        await attachGoodsReceivedDocumentApi(noteId, receiptFile);
        setReceiptDocumentAttached(true);
      }
      await confirmGoodsReceivedNoteApi(noteId);
      await loadData();
      await refreshUser();
      setReceivingOrder(null);
      setReceiptDraftId(null);
      setReceiptIdempotencyKey("");
      setReceiptDocumentAttached(false);
      toast.success("Goods receipt confirmed; accepted quantities and stock movements recorded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not receive order");
    } finally {
      setReceiving(false);
    }
  };

  const startSuggestionOrder = (item: Suggestion) => {
    setOrderForm({
      supplier: item.supplier ? String(item.supplier.id) : "",
      items: [{
        product: String(item.product.id),
        quantity: String(item.suggested_quantity || 1),
        unitCost: item.product.cost_price || "0",
      }],
      currency: profile.currency,
      fxRate: "",
      expectedDate: "",
      supplierInvoiceNumber: "",
      invoiceDate: "",
      dueDate: "",
      discountAmount: "0",
      additionalCharges: "0",
    });
    setOrderOpen(true);
  };

  const startSmartReorder = (item: SmartReorderItem) => {
    if (!item.supplier) {
      toast.error("Add a supplier for this product before creating an order.");
      return;
    }
    setOrderForm({
      supplier: String(item.supplier.id),
      items: [{
        product: String(item.product.id),
        quantity: String(item.suggested_quantity || 1),
        unitCost: String(item.product.cost_price || ""),
      }],
      currency: profile.currency,
      fxRate: "",
      expectedDate: "",
      supplierInvoiceNumber: "",
      invoiceDate: "",
      dueDate: "",
      discountAmount: "0",
      additionalCharges: "0",
    });
    setOrderOpen(true);
  };

  const transitionOrder = async (order: ApiPurchaseOrder, action: "submit" | "approve" | "cancel" | "complete") => {
    try {
      await transitionPurchaseOrderApi(order.id, action);
      await loadData();
      toast.success(`Purchase order ${action === "submit" ? "submitted" : action === "approve" ? "approved" : action === "complete" ? "completed" : "cancelled"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update purchase order");
    }
  };

  const openSupplierHistory = async (supplier: ApiSupplier) => {
    try {
      const history = await fetchSupplierHistoryApi(supplier.id);
      setSupplierHistory(history);
      setSupplierHistoryOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load supplier history");
    }
  };

  const openSupplierStatement = async (supplier: ApiSupplier) => {
    setLoadingSupplierStatement(true);
    try {
      const statement = await fetchSupplierStatementApi(supplier.id);
      setSupplierStatement(statement);
      setSupplierStatementOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load supplier statement");
    } finally {
      setLoadingSupplierStatement(false);
    }
  };

  const printSupplierStatement = () => {
    if (!supplierStatement) return;
    const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>\"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[character] || character);
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      toast.error("Allow pop-ups to print this statement");
      return;
    }
    const currency = escapeHtml(supplierStatement.currency);
    const invoiceRows = supplierStatement.invoices.map((invoice) => `<tr><td>${escapeHtml(invoice.invoice_number)}</td><td>${escapeHtml(prettyDate(invoice.invoice_date))}</td><td>${escapeHtml(invoice.due_date ? prettyDate(invoice.due_date) : "—")}</td><td>${currency} ${Number(invoice.received_total_base).toFixed(2)}</td><td>${currency} ${Number(invoice.paid_total_base).toFixed(2)}</td><td>${currency} ${Number(invoice.returned_total_base).toFixed(2)}</td><td>${currency} ${Number(invoice.outstanding_base).toFixed(2)}</td><td>${escapeHtml(invoice.status)}</td></tr>`).join("");
    const activityRows = supplierStatement.activity.map((row) => `<tr><td>${escapeHtml(prettyDate(row.date))}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.reference)}</td><td>${escapeHtml(row.description)}</td><td>${currency} ${Number(row.amount_base).toFixed(2)}</td><td>${currency} ${Number(row.balance_base).toFixed(2)}</td></tr>`).join("");
    printWindow.document.write(`<!doctype html><html><head><title>Supplier statement</title><style>body{font:14px Arial,sans-serif;margin:32px;color:#222}h1{margin-bottom:4px}p{color:#555}table{border-collapse:collapse;width:100%;margin:18px 0}th,td{border:1px solid #ccc;padding:7px;text-align:left;font-size:12px}th{background:#f2f2f2}.total{font-size:18px;font-weight:bold}</style></head><body><h1>${escapeHtml(supplierStatement.supplier.name)} — Statement</h1><p>As of ${escapeHtml(prettyDate(supplierStatement.as_of))}</p><p class="total">Outstanding: ${currency} ${Number(supplierStatement.totals.outstanding_base).toFixed(2)}</p><h2>Invoices</h2><table><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Received</th><th>Paid</th><th>Returns</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>${invoiceRows || "<tr><td colspan=8>No invoices</td></tr>"}</tbody></table><h2>Activity</h2><table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th>Debit / credit</th><th>Balance</th></tr></thead><tbody>${activityRows || "<tr><td colspan=6>No activity</td></tr>"}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
  };

  const openReturn = (note: ApiGoodsReceivedNote) => {
    setReturnNote(note);
    setReturnQuantities(Object.fromEntries(note.items.map((item) => [item.id, { accepted: "0", damaged: "0" }])));
    setReturnReason("damaged");
    setReturnIdempotencyKey(crypto.randomUUID());
  };

  const submitSupplierReturn = async () => {
    if (!returnNote || savingReturn) return;
    const items = returnNote.items
      .map((item) => ({
        goods_received_note_item: item.id,
        quantity: Number(returnQuantities[item.id]?.accepted) || 0,
        quantity_damaged: Number(returnQuantities[item.id]?.damaged) || 0,
      }))
      .filter((item) => item.quantity > 0 || item.quantity_damaged > 0);
    if (!items.length) {
      toast.error("Enter a quantity to return.");
      return;
    }
    setSavingReturn(true);
    try {
      await createSupplierReturnApi({
        purchase_order: returnNote.purchase_order,
        reason: returnReason,
        idempotency_key: returnIdempotencyKey,
        items,
      });
      await loadData();
      await refreshUser();
      setReturnNote(null);
      toast.success("Supplier return recorded and stock movements updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record supplier return");
    } finally {
      setSavingReturn(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Record stock you receive from suppliers, stock you supply to other shops or companies, and keep invoices in the same workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setSupplierOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Supplier
          </Button>
          <Button onClick={() => setOrderOpen(true)} className="bg-gradient-hero text-primary-foreground">
            <PackagePlus className="mr-2 h-4 w-4" /> Purchase Order
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="shadow-soft">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Incoming Entries</p>
            <p className="mt-1 text-2xl font-display font-bold">{inboundEntries.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">{totalIncomingUnits} units received</p>
          </CardContent>
        </Card>
        <Card className="shadow-soft">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Outgoing Entries</p>
            <p className="mt-1 text-2xl font-display font-bold">{outboundEntries.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">{totalOutgoingUnits} units supplied</p>
          </CardContent>
        </Card>
        <Card className="shadow-soft">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Generated Invoices</p>
            <p className="mt-1 text-2xl font-display font-bold">{supplyEntries.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Full invoice tools now live here too</p>
          </CardContent>
        </Card>
        <Card className="shadow-soft">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Suppliers Saved</p>
            <p className="mt-1 text-2xl font-display font-bold">{suppliers.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Use saved suppliers for quick stock-in entries</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="text-base font-display">Smart Reorder Engine</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {smartReorders.length ? smartReorders.slice(0, 4).map((item) => (
              <div key={item.product.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium">{item.product.name}</p>
                  <Badge variant={item.urgency === "critical" ? "destructive" : "outline"} className="capitalize">{item.urgency}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.supplier?.name || "No supplier"} · lead time {item.lead_time_days} days</p>
                <p className="mt-2 text-sm font-semibold">Order {item.suggested_quantity} units</p>
                <p className="text-xs text-muted-foreground">
                  {item.days_remaining == null ? "No sales trend yet" : `${item.days_remaining} stock days left`} · est. {sym}{Number(item.estimated_cost || 0).toFixed(2)}
                </p>
                <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => startSmartReorder(item)} disabled={!item.supplier}>
                  Create purchase order
                </Button>
              </div>
            )) : (
              <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground sm:col-span-2">
                No reorder risks detected. Products with low stock, supplier lead times, and sales velocity will appear here.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="text-base font-display">Supplier Scorecards</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {scorecards.length ? scorecards.slice(0, 4).map((card) => (
              <div key={card.supplier.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium">{card.supplier.name}</p>
                  <Badge variant={card.health === "risk" ? "destructive" : "outline"} className="capitalize">{card.health}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {card.product_count} products · {card.open_purchase_orders} open POs · {card.low_stock_products} low-stock
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Reliability {card.reliability_score}% · terms {card.payment_terms_days} days
                </p>
              </div>
            )) : (
              <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                Supplier reliability and stock risk will appear as supplier history grows.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="log">Supply Log</TabsTrigger>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="payments">Supplier Payments</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="log" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.05fr_1.35fr]">
            <Card className="shadow-soft">
              <CardHeader>
                <CardTitle className="text-base font-display">Record Supply Movement</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Movement Type</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={entryForm.direction === "incoming" ? "default" : "outline"}
                      onClick={() => setEntryForm((current) => ({ ...current, direction: "incoming", partnerCategory: "supplier", paymentStatus: "paid" }))}
                    >
                      <Truck className="mr-2 h-4 w-4" /> Stock In
                    </Button>
                    <Button
                      type="button"
                      variant={entryForm.direction === "outgoing" ? "default" : "outline"}
                      onClick={() => setEntryForm((current) => ({ ...current, direction: "outgoing", partnerCategory: "company", paymentStatus: "pending" }))}
                    >
                      <ShoppingBag className="mr-2 h-4 w-4" /> Stock Out
                    </Button>
                  </div>
                </div>

                <div>
                  <Label>{entryForm.direction === "incoming" ? "Supplier Name" : "Buyer / Company / Shop"}</Label>
                  <Input
                    list="supplier-partners"
                    value={entryForm.partnerName}
                    onChange={(e) => setEntryForm((current) => ({ ...current, partnerName: e.target.value }))}
                    className="mt-1"
                    placeholder={entryForm.direction === "incoming" ? "e.g. Dell" : "e.g. Green Valley Shop"}
                  />
                  <datalist id="supplier-partners">
                    {suppliers.map((supplier) => <option key={supplier.id} value={supplier.name} />)}
                  </datalist>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Partner Type</Label>
                    <select
                      value={entryForm.partnerCategory}
                      onChange={(e) => setEntryForm((current) => ({ ...current, partnerCategory: e.target.value as typeof current.partnerCategory }))}
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="supplier">Supplier</option>
                      <option value="customer">Customer</option>
                      <option value="shop">Shop</option>
                      <option value="company">Company</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <Label>Payment Status</Label>
                    <select
                      value={entryForm.paymentStatus}
                      onChange={(e) => setEntryForm((current) => ({ ...current, paymentStatus: e.target.value as typeof current.paymentStatus }))}
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="pending">Pending</option>
                      <option value="partial">Part Paid</option>
                      <option value="paid">Paid</option>
                    </select>
                  </div>
                </div>

                <div>
                  <Label>Product</Label>
                  <select
                    value={entryForm.productId}
                    onChange={(e) => {
                      const product = products.find((item) => item.id === e.target.value);
                      setEntryForm((current) => ({
                        ...current,
                        productId: e.target.value,
                        unitCost: current.unitCost || String(product?.costPrice || ""),
                        unitPrice: current.unitPrice || String(product?.price || ""),
                      }));
                    }}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select product</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} ({product.stock} in stock)
                      </option>
                    ))}
                  </select>
                  {selectedProduct ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Current stock: {selectedProduct.stock} units
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Quantity</Label>
                    <Input type="number" min="1" value={entryForm.quantity} onChange={(e) => setEntryForm((current) => ({ ...current, quantity: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Unit Price ({entryCurrencySymbol})</Label>
                    <Input type="number" min="0" value={entryForm.unitPrice} onChange={(e) => setEntryForm((current) => ({ ...current, unitPrice: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Unit Cost ({entryCurrencySymbol})</Label>
                    <Input type="number" min="0" value={entryForm.unitCost} onChange={(e) => setEntryForm((current) => ({ ...current, unitCost: e.target.value }))} className="mt-1" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Currency</Label>
                    <select
                      value={entryForm.currency}
                      onChange={(e) => setEntryForm((current) => ({ ...current, currency: e.target.value, fxRate: "" }))}
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {enabledCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Exchange Rate ({entryForm.currency} to {profile.currency})</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.000001"
                      value={entryForm.currency === profile.currency ? "1" : (entryForm.fxRate || String(profile.exchangeRates?.[entryForm.currency] ?? ""))}
                      onChange={(e) => setEntryForm((current) => ({ ...current, fxRate: e.target.value }))}
                      className="mt-1"
                      disabled={entryForm.currency === profile.currency}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Date</Label>
                    <Input type="date" value={entryForm.movementDate} onChange={(e) => setEntryForm((current) => ({ ...current, movementDate: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Time</Label>
                    <Input type="time" value={entryForm.movementTime} onChange={(e) => setEntryForm((current) => ({ ...current, movementTime: e.target.value }))} className="mt-1" />
                  </div>
                </div>

                <div>
                  <Label>Notes</Label>
                  <Textarea value={entryForm.notes} onChange={(e) => setEntryForm((current) => ({ ...current, notes: e.target.value }))} className="mt-1 min-h-24" placeholder="Optional notes, delivery details, invoice remarks..." />
                </div>

                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <p>
                    Total value: <span className="font-semibold">{entryCurrencySymbol}{entryTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Total cost: {entryCurrencySymbol}{entryTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  {entryCurrency !== profile.currency ? (
                    <p className="mt-1 text-muted-foreground">
                      Base value: {sym}{entryTotalBaseValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  ) : null}
                  {entryCurrency !== profile.currency ? (
                    <p className="mt-1 text-muted-foreground">
                      Using 1 {entryCurrency} = {entryFxRate.toLocaleString(undefined, { maximumFractionDigits: 6 })} {profile.currency}
                    </p>
                  ) : null}
                  <p className="mt-1 text-muted-foreground">
                    This will {entryForm.direction === "incoming" ? "increase" : "decrease"} inventory immediately and save the exact time entered.
                  </p>
                </div>

                <Button
                  onClick={saveEntry}
                  disabled={savingEntry || !entryForm.partnerName.trim() || !entryForm.productId}
                  className="w-full bg-gradient-hero text-primary-foreground"
                >
                  Save Supply Entry
                </Button>
              </CardContent>
            </Card>

            <Card className="shadow-soft">
              <CardHeader>
                <CardTitle className="text-base font-display">Recent Supply History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {supplyEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No supply entries yet. The first one you save will update inventory and appear here with its invoice number.</p>
                ) : supplyEntries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{entry.productName}</p>
                          <Badge variant={entry.direction === "incoming" ? "default" : "secondary"}>
                            {entry.direction === "incoming" ? "Stock In" : "Stock Out"}
                          </Badge>
                          <Badge variant="outline">{entry.paymentStatus}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.quantity} unit(s) {entry.direction === "incoming" ? "from" : "to"} {entry.partnerName}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Movement: {prettyDate(entry.movementDate)} at {entry.movementTime} | Recorded: {prettyDateTime(entry.recordedAt)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Price {symbolForCurrency(entry.currency)}{entry.unitPrice.toFixed(2)} each | Cost {symbolForCurrency(entry.currency)}{entry.unitCost.toFixed(2)} each
                        </p>
                        {entry.currency !== profile.currency ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Base total {sym}{((entry.quantity * entry.unitPrice) * (entry.fxRateToBase || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        ) : null}
                        {entry.notes ? <p className="mt-2 text-xs text-muted-foreground">{entry.notes}</p> : null}
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-xs text-muted-foreground break-all">{entry.invoiceNumber}</p>
                        <p className="mt-1 font-display font-semibold">
                          {symbolForCurrency(entry.currency)}{(entry.quantity * entry.unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          onClick={() => setActiveTab("invoices")}
                        >
                          <FileText className="mr-2 h-3.5 w-3.5" /> Open Invoice
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="orders" className="space-y-6">
          <Card className="shadow-soft">
            <CardHeader>
              <CardTitle className="text-base font-display">Low-Stock Purchase Suggestions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {suggestions.length === 0 ? <p className="text-sm text-muted-foreground">No purchase suggestions right now.</p> : suggestions.map((item) => (
                <div key={item.product.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{item.product.name}</p>
                  <p className="text-xs text-muted-foreground">{item.product.stock} in stock</p>
                  <p className="mt-2 text-sm">Suggested: <span className="font-semibold">{item.suggested_quantity}</span></p>
                  <p className="text-xs text-muted-foreground">Supplier: {item.supplier?.name || "Not assigned"}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => startSuggestionOrder(item)}>Create PO</Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="shadow-soft">
              <CardHeader>
                <CardTitle className="text-base font-display flex items-center gap-2">
                  <Truck className="h-4 w-4" /> Suppliers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {suppliers.map((supplier) => (
                  <div key={supplier.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{supplier.name}</p>
                        <p className="text-xs text-muted-foreground">{[supplier.contact_name, supplier.phone, supplier.email].filter(Boolean).join(" - ") || "No contact details"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Terms {supplier.payment_terms_days ?? 14} days · lead time {supplier.lead_time_days ?? 7} days
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" variant="outline" onClick={() => void openSupplierHistory(supplier)}>History</Button>
                        <Button size="sm" variant="outline" disabled={loadingSupplierStatement} onClick={() => void openSupplierStatement(supplier)}>Statement</Button>
                      </div>
                    </div>
                  </div>
                ))}
                {suppliers.length === 0 && <p className="text-sm text-muted-foreground">Add suppliers to connect purchase orders to real vendors.</p>}
              </CardContent>
            </Card>

            <Card className="shadow-soft">
              <CardHeader>
                <CardTitle className="text-base font-display">Purchase Orders</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {orders.map((order) => (
                  <div key={order.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{order.order_number} - {order.supplier_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.items.length} item(s) - {symbolForCurrency(order.currency || profile.currency)}{Number(order.total_cost).toLocaleString()}
                          {(order.currency || profile.currency) !== profile.currency ? ` (Base ${sym}${Number(order.total_cost_base || 0).toLocaleString()})` : ""}
                        </p>
                      </div>
                      <Badge>{order.status}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {order.status === "draft" && <Button size="sm" variant="outline" onClick={() => void transitionOrder(order, "submit")}>Submit</Button>}
                      {order.status === "submitted" && <Button size="sm" variant="outline" onClick={() => void transitionOrder(order, "approve")}>Approve</Button>}
                      {["approved", "partially_received"].includes(order.status) && <Button size="sm" variant="outline" onClick={() => openReceiveOrder(order)}>Record delivery</Button>}
                      {order.status === "fully_received" && <Button size="sm" variant="outline" onClick={() => void transitionOrder(order, "complete")}>Complete</Button>}
                      {["draft", "submitted", "approved", "partially_received"].includes(order.status) && <Button size="sm" variant="ghost" onClick={() => void transitionOrder(order, "cancel")}>Cancel</Button>}
                    </div>
                    {goodsReceivedNotes.filter((note) => note.purchase_order === order.id).map((note) => (
                      <div key={note.id} className="mt-3 rounded-md bg-muted/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium">{note.grn_number} · {prettyDate(note.delivery_date)}</p>
                          <Badge variant={note.status === "confirmed" ? "default" : "outline"}>{note.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {note.items.reduce((sum, item) => sum + item.quantity_accepted, 0)} accepted · {note.items.reduce((sum, item) => sum + item.quantity_damaged, 0)} damaged · {note.items.reduce((sum, item) => sum + item.quantity_missing, 0)} missing
                        </p>
                        {note.status === "confirmed" && (
                          <Button size="sm" variant="ghost" className="mt-1" onClick={() => openReturn(note)}>
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Supplier return
                          </Button>
                        )}
                        {note.status === "draft" && (
                          <Button size="sm" variant="ghost" className="mt-1" onClick={() => resumeReceipt(order, note)}>
                            Resume draft receipt
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {orders.length === 0 && <p className="text-sm text-muted-foreground">No purchase orders yet.</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="invoices">
          <SupplyInvoiceWorkspace
            title="Supply Invoices"
            description="Use the same invoice tools here inside Suppliers: filter, search, update payment status, print, and download PDF invoices."
          />
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {supplierBalances.map((balance) => (
              <Card key={balance.supplier} className="shadow-soft">
                <CardContent className="p-4">
                  <p className="text-sm font-medium">{balance.supplier_name}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Received: {sym}{Number(balance.received_total_base).toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">Paid: {sym}{Number(balance.paid_total_base).toFixed(2)}</p>
                  <p className="mt-1 text-sm font-semibold">Outstanding: {sym}{Number(balance.outstanding_base).toFixed(2)}</p>
                </CardContent>
              </Card>
            ))}
            {supplierBalances.length === 0 && (
              <p className="text-sm text-muted-foreground">No supplier balances yet. Receive a purchase order to start tracking amounts due.</p>
            )}
          </div>

          {overdueInvoices.length > 0 && (
            <Card className="border-destructive/40 shadow-soft">
              <CardHeader><CardTitle className="text-base font-display">Overdue supplier invoices</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {overdueInvoices.map((invoice) => (
                  <div key={invoice.purchase_order} className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">{invoice.supplier_name} · {invoice.invoice_number || invoice.order_number}</p>
                      <p className="text-xs text-muted-foreground">{invoice.order_number} · due {prettyDate(invoice.due_date)}</p>
                    </div>
                    <p className="text-sm font-semibold text-destructive">{sym}{Number(invoice.outstanding_base).toFixed(2)} outstanding</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="shadow-soft">
            <CardHeader><CardTitle className="text-base font-display">Record supplier payment</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-3">
                <Label>Received purchase order</Label>
                <select
                  value={paymentForm.purchaseOrder}
                  onChange={(event) => setPaymentForm({ ...paymentForm, purchaseOrder: event.target.value })}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Choose purchase order</option>
                  {orders.filter((order) => ["partially_received", "fully_received", "completed", "received"].includes(order.status)).map((order) => (
                    <option key={order.id} value={order.id}>{order.order_number} · {order.supplier_name} · {order.status}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" min="0.01" step="0.01" className="mt-1" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} />
              </div>
              <div>
                <Label>Paid in</Label>
        <select value={paymentForm.currency} onChange={(event) => setPaymentForm({ ...paymentForm, currency: event.target.value, financialAccountId: "" })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {Array.from(new Set([profile.currency, ...enabledCurrencies])).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                </select>
              </div>
              <div><Label>Payment date</Label><Input type="date" className="mt-1" value={paymentForm.paymentDate} onChange={(event) => setPaymentForm({ ...paymentForm, paymentDate: event.target.value })} /></div>
              <div>
                <Label>Method</Label>
                <select value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value as ApiSupplierPayment["method"] })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="bank">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="mobile_money">Mobile money</option>
                  <option value="card">Card</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <Label>Financial account (optional)</Label>
                <select value={eligiblePaymentAccounts.some((account) => String(account.id) === paymentForm.financialAccountId) ? paymentForm.financialAccountId : ""} onChange={(event) => setPaymentForm({ ...paymentForm, financialAccountId: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Do not post to an account ledger</option>
                  {eligiblePaymentAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
                </select>
              </div>
              <div><Label>Reference (optional)</Label><Input className="mt-1" value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} /></div>
              <div className="sm:col-span-2 lg:col-span-3"><Label>Notes (optional)</Label><Input className="mt-1" value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} /></div>
              <Button className="sm:col-span-2 lg:col-span-3" disabled={savingPayment} onClick={() => void saveSupplierPayment()}>{savingPayment ? "Saving…" : "Record Payment"}</Button>
            </CardContent>
          </Card>

          <Card className="shadow-soft">
            <CardHeader><CardTitle className="text-base font-display">Payment history</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {supplierPayments.map((payment) => (
                <div key={payment.id} className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{payment.supplier_name} · {payment.order_number}</p>
                    <p className="text-xs text-muted-foreground">{prettyDate(payment.payment_date)} · {payment.method.replace("_", " ")}{payment.reference ? ` · Ref ${payment.reference}` : ""}</p>
                  </div>
                  <div className="text-sm font-semibold">{payment.currency} {Number(payment.amount).toFixed(2)} <span className="text-xs font-normal text-muted-foreground">({sym}{Number(payment.amount_base).toFixed(2)} base)</span></div>
                </div>
              ))}
              {supplierPayments.length === 0 && <p className="text-sm text-muted-foreground">No supplier payments recorded yet.</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={supplierOpen} onOpenChange={setSupplierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Add Supplier</DialogTitle>
            <DialogDescription>Save supplier details so you can reuse them in supply logs and purchase orders.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} className="mt-1" /></div>
            <div><Label>Contact Person</Label><Input value={supplierForm.contact_name} onChange={(e) => setSupplierForm({ ...supplierForm, contact_name: e.target.value })} className="mt-1" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Phone</Label><Input value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} className="mt-1" /></div>
              <div><Label>Email</Label><Input value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} className="mt-1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Invoice email</Label><Input type="email" value={supplierForm.invoice_email} onChange={(e) => setSupplierForm({ ...supplierForm, invoice_email: e.target.value })} className="mt-1" /></div>
              <div><Label>Tax number</Label><Input value={supplierForm.tax_number} onChange={(e) => setSupplierForm({ ...supplierForm, tax_number: e.target.value })} className="mt-1" /></div>
            </div>
            <div><Label>Address</Label><Input value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} className="mt-1" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Payment terms (days)</Label><Input type="number" min="0" value={supplierForm.payment_terms_days} onChange={(e) => setSupplierForm({ ...supplierForm, payment_terms_days: Number(e.target.value) || 0 })} className="mt-1" /></div>
              <div><Label>Lead time (days)</Label><Input type="number" min="0" value={supplierForm.lead_time_days} onChange={(e) => setSupplierForm({ ...supplierForm, lead_time_days: Number(e.target.value) || 0 })} className="mt-1" /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} className="mt-1" /></div>
            <Button onClick={saveSupplier} disabled={!supplierForm.name.trim()} className="w-full">Save Supplier</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle className="font-display">Create Purchase Order</DialogTitle>
            <DialogDescription>Create a draft order. Stock only changes after an approved order has a confirmed goods-received note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Supplier</Label><select value={orderForm.supplier} onChange={(e) => setOrderForm({ ...orderForm, supplier: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            {orderForm.items.map((line, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_90px_110px_auto] items-end gap-2">
                <div>
                  <Label>Product</Label>
                  <select
                    value={line.product}
                    onChange={(event) => {
                      const product = products.find((item) => item.id === event.target.value);
                      setOrderForm((current) => ({
                        ...current,
                        items: current.items.map((row, rowIndex) => rowIndex === index
                          ? { ...row, product: event.target.value, unitCost: String(product?.costPrice || "") }
                          : row),
                      }));
                    }}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select product</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                  </select>
                </div>
                <div><Label>Qty</Label><Input type="number" min="1" value={line.quantity} onChange={(event) => setOrderForm((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row) }))} className="mt-1" /></div>
                <div><Label>Unit cost</Label><Input type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => setOrderForm((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, unitCost: event.target.value } : row) }))} className="mt-1" /></div>
                <Button type="button" variant="ghost" size="icon" disabled={orderForm.items.length === 1} aria-label="Remove product line" onClick={() => setOrderForm((current) => ({ ...current, items: current.items.filter((_, rowIndex) => rowIndex !== index) }))}>×</Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setOrderForm((current) => ({ ...current, items: [...current.items, { product: "", quantity: "1", unitCost: "" }] }))}>Add product</Button>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Currency</Label>
                <select value={orderForm.currency} onChange={(e) => setOrderForm({ ...orderForm, currency: e.target.value, fxRate: "" })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {enabledCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              </div>
              <div>
                <Label>Exchange Rate ({orderForm.currency} to {profile.currency})</Label>
                <Input type="number" value={orderForm.currency === profile.currency ? "1" : (orderForm.fxRate || String(profile.exchangeRates?.[orderForm.currency] ?? ""))} onChange={(e) => setOrderForm({ ...orderForm, fxRate: e.target.value })} className="mt-1" disabled={orderForm.currency === profile.currency} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Expected delivery</Label><Input type="date" value={orderForm.expectedDate} onChange={(e) => setOrderForm({ ...orderForm, expectedDate: e.target.value })} className="mt-1" /></div>
              <div><Label>Supplier invoice #</Label><Input value={orderForm.supplierInvoiceNumber} onChange={(e) => setOrderForm({ ...orderForm, supplierInvoiceNumber: e.target.value })} className="mt-1" /></div>
              <div><Label>Invoice date</Label><Input type="date" value={orderForm.invoiceDate} onChange={(e) => setOrderForm({ ...orderForm, invoiceDate: e.target.value })} className="mt-1" /></div>
              <div><Label>Due date</Label><Input type="date" value={orderForm.dueDate} onChange={(e) => setOrderForm({ ...orderForm, dueDate: e.target.value })} className="mt-1" /></div>
              <div><Label>Discount</Label><Input type="number" min="0" step="0.01" value={orderForm.discountAmount} onChange={(e) => setOrderForm({ ...orderForm, discountAmount: e.target.value })} className="mt-1" /></div>
              <div><Label>Additional charges</Label><Input type="number" min="0" step="0.01" value={orderForm.additionalCharges} onChange={(e) => setOrderForm({ ...orderForm, additionalCharges: e.target.value })} className="mt-1" /></div>
            </div>
            <p className="text-xs text-muted-foreground">
              Base estimate: {sym}{(
                orderForm.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitCost) || 0), 0)
                * (orderForm.currency === profile.currency ? 1 : (Number(orderForm.fxRate) || profile.exchangeRates?.[orderForm.currency] || 0))
              ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <Button onClick={createOrder} disabled={!orderForm.supplier || !orderForm.items.some((item) => item.product)} className="w-full">Save Draft Order</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!receivingOrder} onOpenChange={(open) => { if (!open && !receiving) setReceivingOrder(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Record delivery for {receivingOrder?.order_number}</DialogTitle>
            <DialogDescription>Enter delivered, damaged, and missing quantities for each order line. Only accepted goods enter stock.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {receiptDraftId != null && <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">A draft GRN exists. Its delivery quantities are locked; you can add or retry the document upload and confirmation.</p>}
            <div><Label>Delivery date</Label><Input type="date" disabled={receiptDraftId != null} className="mt-1" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} /></div>
            {receivingOrder?.items.map((item) => {
              const line = receiptLines.find((row) => row.purchaseOrderItem === item.id);
              if (!line) return null;
              const remaining = item.quantity_ordered - (item.quantity_received || 0);
              return (
                <div key={item.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div><p className="text-sm font-medium">{item.product_name}</p><p className="text-xs text-muted-foreground">{remaining} remaining to deliver</p></div>
                    <span className="text-xs text-muted-foreground">{item.sku}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label>Delivered</Label><Input type="number" min="0" max={remaining} disabled={receiptDraftId != null} value={line.quantity} onChange={(event) => setReceiptLines((current) => current.map((row) => row.purchaseOrderItem === line.purchaseOrderItem ? { ...row, quantity: event.target.value } : row))} className="mt-1" /></div>
                    <div><Label>Damaged</Label><Input type="number" min="0" disabled={receiptDraftId != null} value={line.damaged} onChange={(event) => setReceiptLines((current) => current.map((row) => row.purchaseOrderItem === line.purchaseOrderItem ? { ...row, damaged: event.target.value } : row))} className="mt-1" /></div>
                    <div><Label>Missing</Label><Input type="number" min="0" max={remaining} disabled={receiptDraftId != null} value={line.missing} onChange={(event) => setReceiptLines((current) => current.map((row) => row.purchaseOrderItem === line.purchaseOrderItem ? { ...row, missing: event.target.value } : row))} className="mt-1" /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label>Actual unit cost</Label><Input type="number" min="0" step="0.01" disabled={receiptDraftId != null} value={line.unitCost} onChange={(event) => setReceiptLines((current) => current.map((row) => row.purchaseOrderItem === line.purchaseOrderItem ? { ...row, unitCost: event.target.value } : row))} className="mt-1" /></div>
                    <div><Label>Batch / lot</Label><Input disabled={receiptDraftId != null} value={line.batchNumber} onChange={(event) => setReceiptLines((current) => current.map((row) => row.purchaseOrderItem === line.purchaseOrderItem ? { ...row, batchNumber: event.target.value } : row))} className="mt-1" /></div>
                    <div><Label>Expiry</Label><Input type="date" disabled={receiptDraftId != null} value={line.expiryDate} onChange={(event) => setReceiptLines((current) => current.map((row) => row.purchaseOrderItem === line.purchaseOrderItem ? { ...row, expiryDate: event.target.value } : row))} className="mt-1" /></div>
                  </div>
                </div>
              );
            })}
            <div><Label>Delivery documents (PDF/JPG/PNG, up to 10 MB)</Label><Input type="file" accept=".pdf,.jpg,.jpeg,.png" className="mt-1" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} /></div>
            <div><Label>Notes</Label><Textarea disabled={receiptDraftId != null} value={receiptNotes} onChange={(event) => setReceiptNotes(event.target.value)} className="mt-1" /></div>
            <Button className="w-full" disabled={receiving} onClick={() => void receiveOrder()}><Check className="mr-2 h-4 w-4" />{receiving ? "Confirming…" : "Save and confirm delivery"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!returnNote} onOpenChange={(open) => { if (!open && !savingReturn) setReturnNote(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Return goods to supplier</DialogTitle>
            <DialogDescription>Accepted stock is removed and credited; goods already rejected as damaged are logged without changing stock again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason</Label>
              <select value={returnReason} onChange={(event) => setReturnReason(event.target.value as typeof returnReason)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="damaged">Damaged</option><option value="incorrect">Incorrect delivery</option><option value="expired">Expired</option><option value="excess">Excess</option><option value="other">Other</option>
              </select>
            </div>
            {returnNote?.items.filter((item) => item.quantity_accepted > 0 || item.quantity_damaged > 0).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded border p-3">
                <div className="min-w-0"><p className="text-sm font-medium">{item.product_name}</p><p className="text-xs text-muted-foreground">{returnNote.grn_number} · accepted {item.quantity_accepted}, damaged {item.quantity_damaged}</p></div>
                <div className="grid w-40 grid-cols-2 gap-2">
                  <div><Label className="text-xs">Accepted</Label><Input aria-label={`Accepted return quantity for ${item.product_name}`} type="number" min="0" max={item.quantity_accepted} value={returnQuantities[item.id]?.accepted || "0"} onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.id]: { accepted: event.target.value, damaged: current[item.id]?.damaged || "0" } }))} /></div>
                  <div><Label className="text-xs">Damaged</Label><Input aria-label={`Damaged return quantity for ${item.product_name}`} type="number" min="0" max={item.quantity_damaged} value={returnQuantities[item.id]?.damaged || "0"} onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.id]: { accepted: current[item.id]?.accepted || "0", damaged: event.target.value } }))} /></div>
                </div>
              </div>
            ))}
            <Button className="w-full" disabled={savingReturn} onClick={() => void submitSupplierReturn()}>{savingReturn ? "Saving…" : "Record supplier return"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={supplierHistoryOpen} onOpenChange={setSupplierHistoryOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{supplierHistory?.supplier.name || "Supplier"} history</DialogTitle>
            <DialogDescription>Preferred products, purchase orders, settlements, and returns.</DialogDescription>
          </DialogHeader>
          {supplierHistory && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <p>Invoices: {supplierHistory.purchase_orders.filter((order) => order.supplier_invoice_number).length}</p>
                <p>Payments: {supplierHistory.payments.length}</p>
                <p>Orders: {supplierHistory.purchase_orders.length}</p>
                <p>Returns: {supplierHistory.returns.length}</p>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Preferred products</p>
                {supplierHistory.products.map((product) => <p key={product.id} className="border-b py-2 text-sm">{product.name} · {product.stock} in stock · {product.sku}</p>)}
                {!supplierHistory.products.length && <p className="text-sm text-muted-foreground">No preferred products assigned.</p>}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Purchase history</p>
                {supplierHistory.purchase_orders.map((order) => <p key={order.id} className="border-b py-2 text-sm">{order.order_number} · {order.status} · {order.supplier_invoice_number || "No supplier invoice"}</p>)}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Supplier-specific cost history</p>
                {supplierHistory.purchase_cost_history.map((record) => (
                  <p key={record.id} className="border-b py-2 text-sm">
                    {record.product_name} · {record.currency} {Number(record.unit_cost).toFixed(2)} / unit
                    {" · "}{sym}{Number(record.unit_cost_base).toFixed(2)} base
                    {" · "}{record.grn_number} · {prettyDateTime(record.created_at)}
                  </p>
                ))}
                {!supplierHistory.purchase_cost_history.length && <p className="text-sm text-muted-foreground">No confirmed purchase costs recorded yet.</p>}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Payment history</p>
                {supplierHistory.payments.map((payment) => (
                  <p key={payment.id} className="border-b py-2 text-sm">
                    {payment.order_number} · {prettyDate(payment.payment_date)} · {payment.currency} {Number(payment.amount).toFixed(2)}
                  </p>
                ))}
                {!supplierHistory.payments.length && <p className="text-sm text-muted-foreground">No supplier payments recorded.</p>}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Returns</p>
                {supplierHistory.returns.map((record) => (
                  <p key={record.id} className="border-b py-2 text-sm">
                    {record.reason} · {prettyDate(record.return_date)} · {sym}{Number(record.total_amount_base).toFixed(2)} credit
                  </p>
                ))}
                {!supplierHistory.returns.length && <p className="text-sm text-muted-foreground">No supplier returns recorded.</p>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={supplierStatementOpen} onOpenChange={setSupplierStatementOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{supplierStatement?.supplier.name || "Supplier"} statement</DialogTitle>
            <DialogDescription>Received invoices, supplier returns, payments, and the remaining balance as of {supplierStatement ? prettyDate(supplierStatement.as_of) : "today"}.</DialogDescription>
          </DialogHeader>
          {supplierStatement ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Received", supplierStatement.totals.received_total_base],
                  ["Returns", supplierStatement.totals.returned_total_base],
                  ["Paid", supplierStatement.totals.paid_total_base],
                  ["Outstanding", supplierStatement.totals.outstanding_base],
                ].map(([label, amount]) => (
                  <div key={label} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-base font-semibold">{symbolForCurrency(supplierStatement.currency)}{Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                ))}
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Invoice balances</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="bg-muted/50"><tr>{["Invoice", "Date", "Due", "Received", "Paid", "Returns", "Outstanding", "Status"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
                    <tbody>
                      {supplierStatement.invoices.map((invoice) => (
                        <tr key={invoice.purchase_order} className="border-t">
                          <td className="px-3 py-2">{invoice.invoice_number}</td><td className="px-3 py-2">{prettyDate(invoice.invoice_date)}</td><td className="px-3 py-2">{invoice.due_date ? prettyDate(invoice.due_date) : "—"}</td>
                          <td className="px-3 py-2">{Number(invoice.received_total_base).toFixed(2)}</td><td className="px-3 py-2">{Number(invoice.paid_total_base).toFixed(2)}</td><td className="px-3 py-2">{Number(invoice.returned_total_base).toFixed(2)}</td><td className="px-3 py-2 font-medium">{Number(invoice.outstanding_base).toFixed(2)}</td><td className="px-3 py-2"><Badge variant={invoice.status === "overdue" ? "destructive" : invoice.status === "settled" ? "secondary" : "outline"}>{invoice.status}</Badge></td>
                        </tr>
                      ))}
                      {!supplierStatement.invoices.length && <tr><td colSpan={8} className="px-3 py-5 text-center text-muted-foreground">No received invoices to show.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Statement activity</h3>
                <div className="space-y-2">
                  {supplierStatement.activity.map((row, index) => (
                    <div key={`${row.type}-${row.order_id}-${row.reference}-${index}`} className="grid gap-1 rounded-lg border p-3 text-xs sm:grid-cols-[90px_90px_1fr_130px_130px] sm:items-center">
                      <span>{prettyDate(row.date)}</span><Badge variant="outline" className="w-fit">{row.type}</Badge><span>{row.description} · {row.reference}</span>
                      <span className={Number(row.amount_base) < 0 ? "text-emerald-700" : ""}>{Number(row.amount_base) < 0 ? "−" : "+"}{symbolForCurrency(supplierStatement.currency)}{Math.abs(Number(row.amount_base)).toFixed(2)}</span>
                      <span>Balance {symbolForCurrency(supplierStatement.currency)}{Number(row.balance_base).toFixed(2)}</span>
                    </div>
                  ))}
                  {!supplierStatement.activity.length && <p className="rounded-lg border p-4 text-sm text-muted-foreground">No supplier activity yet.</p>}
                </div>
              </section>
              <div className="flex justify-end"><Button variant="outline" onClick={printSupplierStatement}><FileText className="mr-2 h-4 w-4" />Print statement</Button></div>
            </div>
          ) : <p className="text-sm text-muted-foreground">Loading supplier statement…</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Suppliers;
