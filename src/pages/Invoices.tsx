import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileText, MessageCircle, Plus, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchReceiptApi, listSalesApi, type ApiSale } from "@/lib/api";
import { symbolForCurrency } from "@/lib/currency";
import { useStore, type Customer } from "@/lib/store";

type InvoiceFilter = "all" | "outstanding" | "overdue" | "paid";
type InvoiceStatus = "Paid" | "Part paid" | "Open" | "Overdue";
type InvoiceSale = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerId: string;
  total: number;
  amountPaidBase: number;
  balanceDue: number;
  dueDate?: string;
};

function localDateKey() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function invoiceHtml(receipt: Awaited<ReturnType<typeof fetchReceiptApi>>, currency: string, currencySymbol: string, invoiceNumber: string) {
  const number = invoiceNumber || receipt.invoice_number || `INV-${receipt.receipt_number}`;
  const safeSymbol = escapeHtml(currencySymbol);
  const paid = Number(receipt.amount_paid_base || 0);
  const due = Math.max(0, Number(receipt.balance_due || 0));
  const status: InvoiceStatus = due <= 0.005
    ? "Paid"
    : receipt.due_date && receipt.due_date < localDateKey()
      ? "Overdue"
      : paid > 0 ? "Part paid" : "Open";
  const rows = receipt.items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unit_price || 0);
    const discount = Number(item.discount_amount || 0);
    const lineTotal = Number(item.subtotal ?? (quantity * (unitPrice - discount)));
    return `<tr><td>${escapeHtml(item.product_name || "Item")}</td><td class="num">${quantity}</td><td class="num">${safeSymbol}${unitPrice.toFixed(2)}</td><td class="num">${safeSymbol}${discount.toFixed(2)}</td><td class="num">${safeSymbol}${lineTotal.toFixed(2)}</td></tr>`;
  }).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${escapeHtml(number)}</title>
<style>
  *{box-sizing:border-box}body{margin:0;background:#f6f4ee;color:#17251f;font:14px Arial,sans-serif}.page{max-width:850px;margin:32px auto;padding:0 18px}.invoice{background:#fff;border:1px solid #e1e5df;border-radius:18px;overflow:hidden}.top{padding:30px 34px;background:#123b2b;color:#fff;display:flex;justify-content:space-between;gap:24px}.brand{font-size:23px;font-weight:700}.muted{color:#68766f}.top .muted{color:#d2ddd6}.eyebrow{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:#ffcf72}.number{text-align:right}.number strong{display:block;margin-top:8px;font-size:20px}.body{padding:30px 34px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:26px}.box{padding:16px;background:#f7f5ef;border:1px solid #e6e4dc;border-radius:12px}.label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#68766f}.value{margin-top:8px;font-size:16px;font-weight:700}.small{margin-top:6px;color:#68766f}.details{display:flex;justify-content:space-between;gap:16px;margin-bottom:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px 10px;border-bottom:1px solid #e6e9e5;text-align:left}th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#68766f;background:#fafbf9}.num{text-align:right;white-space:nowrap}.summary{width:min(360px,100%);margin:24px 0 0 auto}.summary div{display:flex;justify-content:space-between;gap:16px;padding:10px 12px;border-bottom:1px solid #e6e9e5}.summary .balance{background:#fff3d9;font-weight:700;font-size:16px;border-radius:8px}.footer{margin-top:30px;padding-top:16px;border-top:1px solid #e6e9e5;color:#68766f;font-size:12px}@media(max-width:600px){.page{margin:10px auto;padding:0 8px}.top,.body{padding:22px 18px}.top{flex-direction:column}.number{text-align:left}.meta{grid-template-columns:1fr}.details{flex-direction:column}th,td{padding:10px 6px;font-size:12px}}@media print{body{background:#fff}.page{max-width:none;margin:0;padding:0}.invoice{border:0;border-radius:0}.top{print-color-adjust:exact;-webkit-print-color-adjust:exact}.box,.summary .balance{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body><main class="page"><article class="invoice"><header class="top"><div><div class="eyebrow">Customer invoice</div><div class="brand">${escapeHtml(receipt.business_name || "Business")}</div>${receipt.branch ? `<div class="muted" style="margin-top:6px">${escapeHtml(receipt.branch)}</div>` : ""}</div><div class="number"><span class="muted">Invoice number</span><strong>${escapeHtml(number)}</strong><span class="muted">${escapeHtml(status)}</span></div></header><section class="body"><div class="meta"><div class="box"><div class="label">Bill to</div><div class="value">${escapeHtml(receipt.customer || "Customer")}</div>${receipt.customer_phone ? `<div class="small">${escapeHtml(receipt.customer_phone)}</div>` : ""}</div><div class="box"><div class="label">Invoice date</div><div class="value">${escapeHtml(formatDate(receipt.date))}</div><div class="small">Due date: ${escapeHtml(formatDate(receipt.due_date || undefined))}</div></div></div><div class="details"><strong>Items and services</strong><span class="muted">Amounts in ${escapeHtml(currency)}</span></div><table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Discount/unit</th><th class="num">Amount</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No line items</td></tr>`}</tbody></table><div class="summary"><div><span>Total</span><strong>${safeSymbol}${Number(receipt.total || 0).toFixed(2)}</strong></div><div><span>Paid</span><strong>${safeSymbol}${paid.toFixed(2)}</strong></div><div class="balance"><span>Balance due</span><strong>${safeSymbol}${due.toFixed(2)}</strong></div></div><footer class="footer">Thank you for your business. ${escapeHtml(receipt.business_name || "")}</footer></section></article></main></body></html>`;
}

function getInvoiceStatus(sale: InvoiceSale): InvoiceStatus {
  const balance = Math.max(0, sale.balanceDue || 0);
  if (balance <= 0.005) return "Paid";
  if (sale.dueDate && sale.dueDate < localDateKey()) return "Overdue";
  return (sale.amountPaidBase || 0) > 0 ? "Part paid" : "Open";
}

const statusStyles: Record<InvoiceStatus, string> = {
  Paid: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  "Part paid": "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  Open: "border-border bg-muted text-muted-foreground",
  Overdue: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
};

function formatAmount(amount: number, symbol: string) {
  return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const Invoices = () => {
  const navigate = useNavigate();
  const { customers, profile } = useStore();
  const salesQuery = useQuery({ queryKey: ["invoice-sales"], queryFn: listSalesApi, staleTime: 0 });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [printingId, setPrintingId] = useState<string | null>(null);
  const symbol = profile.currencySymbol || symbolForCurrency(profile.currency);

  const invoices = useMemo(() => (salesQuery.data || [])
    .filter((sale): sale is ApiSale & { customer: number } => Boolean(sale.customer))
    .map((apiSale) => {
      const sale: InvoiceSale = {
        id: String(apiSale.id),
        invoiceNumber: apiSale.invoice_number || `INV-${String(apiSale.id).padStart(6, "0")}`,
        invoiceDate: apiSale.date,
        customerId: String(apiSale.customer),
        total: Number(apiSale.total || 0),
        amountPaidBase: Number(apiSale.amount_paid_base || 0),
        balanceDue: Number(apiSale.balance_due || 0),
        dueDate: apiSale.due_date || undefined,
      };
      return {
        sale,
        customer: customers.find((customer) => customer.id === sale.customerId),
        status: getInvoiceStatus(sale),
        balance: Math.max(0, sale.balanceDue || 0),
      };
    })
    .sort((a, b) => b.sale.invoiceDate.localeCompare(a.sale.invoiceDate)), [salesQuery.data, customers]);

  const totalInvoiced = invoices.reduce((sum, invoice) => sum + invoice.sale.total, 0);
  const totalOutstanding = invoices.reduce((sum, invoice) => sum + invoice.balance, 0);
  const overdueTotal = invoices.filter((invoice) => invoice.status === "Overdue")
    .reduce((sum, invoice) => sum + invoice.balance, 0);

  const visibleInvoices = invoices.filter(({ sale, customer, status, balance }) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [sale.invoiceNumber, customer?.name, customer?.phone]
      .some((value) => String(value || "").toLowerCase().includes(query));
    const matchesFilter = filter === "all"
      || (filter === "outstanding" && balance > 0.005)
      || (filter === "overdue" && status === "Overdue")
      || (filter === "paid" && status === "Paid");
    return matchesSearch && matchesFilter;
  });

  const printInvoice = async (sale: InvoiceSale) => {
    if (!/^\d+$/.test(sale.id)) {
      toast.error("Sync this sale before generating its invoice.");
      return;
    }
    const printWindow = window.open("", "_blank", "width=900,height=850");
    if (!printWindow) {
      toast.error("Allow pop-ups to print or save an invoice as PDF.");
      return;
    }
    setPrintingId(sale.id);
    printWindow.document.write("<!doctype html><title>Preparing invoice</title><p style='font:16px Arial;padding:32px'>Preparing invoice…</p>");
    try {
      const receipt = await fetchReceiptApi(sale.id);
      printWindow.document.open();
      printWindow.document.write(invoiceHtml(receipt, profile.currency, symbol, sale.invoiceNumber));
      printWindow.document.close();
      window.setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 350);
    } catch (error) {
      printWindow.close();
      toast.error(error instanceof Error ? error.message : "Could not load this invoice.");
    } finally {
      setPrintingId(null);
    }
  };

  const shareInvoiceDetails = (sale: InvoiceSale, customer?: Customer) => {
    const paid = sale.amountPaidBase || 0;
    const balance = Math.max(0, sale.balanceDue || 0);
    const message = [
      profile.name || "Customer invoice",
      `Invoice: ${sale.invoiceNumber}`,
      `Customer: ${customer?.name || "Customer"}`,
      `Date: ${formatDate(sale.invoiceDate)}`,
      `Total: ${formatAmount(sale.total, symbol)}`,
      `Paid: ${formatAmount(paid, symbol)}`,
      `Balance due: ${formatAmount(balance, symbol)}`,
      sale.dueDate ? `Due date: ${formatDate(sale.dueDate)}` : "",
    ].filter(Boolean).join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };

  const filterOptions: Array<{ value: InvoiceFilter; label: string }> = [
    { value: "all", label: "All invoices" },
    { value: "outstanding", label: "Outstanding" },
    { value: "overdue", label: "Overdue" },
    { value: "paid", label: "Paid" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" aria-hidden="true" />
            <h2 className="font-display text-2xl font-bold">Invoices</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Create invoices from customer sales, track what is still due, and print or share invoice details.
          </p>
        </div>
        <Button onClick={() => navigate(customers.length ? "/sales?action=add&invoice=1" : "/customers")}>
          <Plus className="mr-2 h-4 w-4" /> {customers.length ? "New invoice" : "Add a customer"}
        </Button>
      </div>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Invoice totals">
        {[
          { label: "Total invoiced", value: formatAmount(totalInvoiced, symbol), detail: `${invoices.length} customer invoice${invoices.length === 1 ? "" : "s"}` },
          { label: "Outstanding", value: formatAmount(totalOutstanding, symbol), detail: "Balance still to collect" },
          { label: "Overdue", value: formatAmount(overdueTotal, symbol), detail: `${invoices.filter((invoice) => invoice.status === "Overdue").length} past due` },
        ].map((metric) => (
          <Card key={metric.label} className="shadow-soft">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="mt-1 font-display text-xl font-bold">{metric.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="shadow-soft">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Search invoices" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice or customer" className="pl-9" />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter invoices">
              {filterOptions.map((option) => (
                <Button key={option.value} type="button" size="sm" variant={filter === option.value ? "default" : "outline"} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)} className="shrink-0">
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          {salesQuery.isLoading ? (
            <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground" role="status">Loading invoices...</div>
          ) : salesQuery.isError ? (
            <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
              <p className="text-sm text-destructive" role="alert">{salesQuery.error instanceof Error ? salesQuery.error.message : "Invoices could not be loaded."}</p>
              <Button className="mt-4" variant="outline" onClick={() => void salesQuery.refetch()}>Try again</Button>
            </div>
          ) : visibleInvoices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground/70" aria-hidden="true" />
              <h3 className="mt-3 font-display font-semibold">{invoices.length === 0 ? "No customer invoices yet" : "No invoices match this search"}</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                {invoices.length === 0
                  ? "Issue an invoice when recording a sale by choosing a saved customer. Paid and part-paid sales can have invoices too."
                  : "Try a different invoice number, customer name, or filter."}
              </p>
              {invoices.length === 0 && (
                <Button className="mt-4" variant="outline" onClick={() => navigate(customers.length ? "/sales?action=add&invoice=1" : "/customers")}>
                  {customers.length ? "Create your first invoice" : "Add a customer first"}
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Invoice</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Issued</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="px-4 py-3 text-right font-medium">Balance</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleInvoices.map(({ sale, customer, status, balance }) => (
                    <tr key={sale.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold">{sale.invoiceNumber}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{customer?.name || "Customer record unavailable"}</div>
                        {customer?.phone && <div className="mt-0.5 text-xs text-muted-foreground">{customer.phone}</div>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{formatDate(sale.invoiceDate)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{formatDate(sale.dueDate)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{formatAmount(sale.total, symbol)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium">{formatAmount(balance, symbol)}</td>
                      <td className="px-4 py-3"><Badge variant="outline" className={statusStyles[status]}>{status}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button type="button" size="icon" variant="ghost" aria-label={`Print or save ${sale.invoiceNumber}`} title="Print or save as PDF" disabled={printingId === sale.id} onClick={() => void printInvoice(sale)}>
                            <Printer className="h-4 w-4" />
                          </Button>
                          <Button type="button" size="icon" variant="ghost" aria-label={`Share details for ${sale.invoiceNumber}`} title="Share invoice details on WhatsApp" onClick={() => shareInvoiceDetails(sale, customer)}>
                            <MessageCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Invoices;
