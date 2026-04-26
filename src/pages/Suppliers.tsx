import { useEffect, useMemo, useState } from "react";
import { FileText, PackagePlus, Plus, ShoppingBag, Truck } from "lucide-react";
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
  createSupplierApi,
  fetchPurchaseSuggestions,
  listPurchaseOrdersApi,
  listSuppliersApi,
  receivePurchaseOrderApi,
  type ApiPurchaseOrder,
  type ApiSupplier,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { symbolForCurrency } from "@/lib/currency";

type Suggestion = Awaited<ReturnType<typeof fetchPurchaseSuggestions>>["items"][number];

const emptySupplier = { name: "", contact_name: "", phone: "", email: "", address: "", notes: "" };

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

const Suppliers = () => {
  const { products, profile, supplyEntries, addSupplyEntry } = useStore();
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [orders, setOrders] = useState<ApiPurchaseOrder[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
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
    product: "",
    quantity: "1",
    unitCost: "",
    currency: profile.currency,
    fxRate: "",
    expectedDate: "",
  });
  const sym = profile.currencySymbol || "R";
  const enabledCurrencies = profile.enabledCurrencies?.length ? profile.enabledCurrencies : [profile.currency];

  const loadData = async () => {
    const [nextSuppliers, nextOrders, nextSuggestions] = await Promise.all([
      listSuppliersApi(),
      listPurchaseOrdersApi(),
      fetchPurchaseSuggestions(7),
    ]);
    setSuppliers(nextSuppliers);
    setOrders(nextOrders);
    setSuggestions(nextSuggestions.items);
  };

  useEffect(() => {
    loadData().catch(() => {
      setSuppliers([]);
      setOrders([]);
      setSuggestions([]);
    });
  }, []);

  useEffect(() => {
    setOrderForm((current) => ({ ...current, currency: profile.currency }));
  }, [profile.currency]);

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
  const selectedOrderProduct = useMemo(
    () => products.find((product) => product.id === orderForm.product),
    [orderForm.product, products]
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
    try {
      const created = await createSupplierApi(supplierForm);
      setSuppliers((prev) => [created, ...prev]);
      setSupplierForm(emptySupplier);
      setSupplierOpen(false);
      toast.success("Supplier added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add supplier");
    }
  };

  const saveEntry = () => {
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

    const result = addSupplyEntry({
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

    if (!result.ok) {
      toast.error(result.message || "Could not save this supply entry");
      return;
    }

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
    toast.success(result.entry?.direction === "incoming" ? "Supply received and inventory updated" : "Supply sale recorded and inventory updated");
    setActiveTab("invoices");
  };

  const createOrder = async () => {
    if (!orderForm.supplier || !orderForm.product) return;
    try {
      const created = await createPurchaseOrderApi({
        supplier: Number(orderForm.supplier),
        branch: null,
        currency: orderForm.currency,
        fx_rate_to_base: orderForm.currency === profile.currency ? undefined : (Number(orderForm.fxRate) || profile.exchangeRates?.[orderForm.currency] || undefined),
        expected_date: orderForm.expectedDate || null,
        status: "ordered",
        items: [{
          product: Number(orderForm.product),
          quantity_ordered: Number(orderForm.quantity) || 1,
          quantity_received: 0,
          unit_cost: (Number(orderForm.unitCost) || selectedOrderProduct?.costPrice || 0).toFixed(2),
        }],
      });
      setOrders((prev) => [created, ...prev]);
      setOrderOpen(false);
      toast.success("Purchase order created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create purchase order");
    }
  };

  const receiveOrder = async (order: ApiPurchaseOrder) => {
    try {
      const updated = await receivePurchaseOrderApi(order.id);
      setOrders((prev) => prev.map((item) => item.id === updated.id ? updated : item));
      toast.success("Stock received and inventory updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not receive order");
    }
  };

  const startSuggestionOrder = (item: Suggestion) => {
    setOrderForm({
      supplier: item.supplier ? String(item.supplier.id) : "",
      product: String(item.product.id),
      quantity: String(item.suggested_quantity || 1),
      unitCost: item.product.cost_price || "0",
      currency: profile.currency,
      fxRate: "",
      expectedDate: "",
    });
    setOrderOpen(true);
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="log">Supply Log</TabsTrigger>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
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
                  disabled={!entryForm.partnerName.trim() || !entryForm.productId}
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
                    <p className="text-sm font-medium">{supplier.name}</p>
                    <p className="text-xs text-muted-foreground">{[supplier.contact_name, supplier.phone, supplier.email].filter(Boolean).join(" - ") || "No contact details"}</p>
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
                    {order.status !== "received" && order.status !== "cancelled" && (
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => receiveOrder(order)}>Receive Stock</Button>
                    )}
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
            <Button onClick={saveSupplier} disabled={!supplierForm.name.trim()} className="w-full">Save Supplier</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Create Purchase Order</DialogTitle>
            <DialogDescription>Create a purchase order for a saved supplier and track its expected stock delivery.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Supplier</Label><select value={orderForm.supplier} onChange={(e) => setOrderForm({ ...orderForm, supplier: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><Label>Product</Label><select value={orderForm.product} onChange={(e) => { const product = products.find((p) => p.id === e.target.value); setOrderForm({ ...orderForm, product: e.target.value, unitCost: String(product?.costPrice || "") }); }} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select product</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
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
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Quantity</Label><Input type="number" value={orderForm.quantity} onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })} className="mt-1" /></div>
              <div><Label>Unit Cost ({symbolForCurrency(orderForm.currency)})</Label><Input type="number" value={orderForm.unitCost} onChange={(e) => setOrderForm({ ...orderForm, unitCost: e.target.value })} className="mt-1" /></div>
              <div><Label>Expected</Label><Input type="date" value={orderForm.expectedDate} onChange={(e) => setOrderForm({ ...orderForm, expectedDate: e.target.value })} className="mt-1" /></div>
            </div>
            <p className="text-xs text-muted-foreground">
              Base estimate: {sym}{((Number(orderForm.quantity) || 0) * (Number(orderForm.unitCost) || 0) * (orderForm.currency === profile.currency ? 1 : (Number(orderForm.fxRate) || profile.exchangeRates?.[orderForm.currency] || 0))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <Button onClick={createOrder} disabled={!orderForm.supplier || !orderForm.product} className="w-full">Create Order</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Suppliers;
