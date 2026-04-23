import { useMemo, useState } from "react";
import { Download, FileText, Printer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStore } from "@/lib/store";
import { symbolForCurrency } from "@/lib/currency";
import {
  buildInvoiceHtml,
  downloadSupplyInvoicePdf,
  formatSupplyDate,
  formatSupplyDateTime,
  invoiceAmount,
  invoiceCostAmount,
  invoiceTypeLabel,
  paymentStatusLabel,
} from "@/lib/supplyInvoices";
import { toast } from "sonner";

function printInvoice(html: string) {
  const printWindow = window.open("", "_blank", "width=960,height=720");
  if (!printWindow) {
    toast.error("Could not open print window");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.print();
  };
}

const Invoices = () => {
  const { supplyEntries, profile, updateSupplyEntry } = useStore();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "partial" | "paid">("all");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const filteredInvoices = useMemo(() => {
    return supplyEntries.filter((entry) => {
      const matchesStatus = statusFilter === "all" || entry.paymentStatus === statusFilter;
      const query = search.trim().toLowerCase();
      const matchesSearch = !query || [
        entry.invoiceNumber,
        entry.partnerName,
        entry.productName,
        entry.partnerCategory,
      ].some((value) => value.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [search, statusFilter, supplyEntries]);

  const selectedInvoice = useMemo(
    () => filteredInvoices.find((entry) => entry.id === selectedInvoiceId) || supplyEntries.find((entry) => entry.id === selectedInvoiceId) || null,
    [filteredInvoices, selectedInvoiceId, supplyEntries]
  );

  const totals = useMemo(() => {
    return filteredInvoices.reduce((acc, entry) => {
      const total = invoiceAmount(entry);
      acc.total += total;
      if (entry.paymentStatus === "paid") acc.paid += total;
      if (entry.paymentStatus === "partial") acc.partial += total;
      if (entry.paymentStatus === "pending") acc.pending += total;
      return acc;
    }, { total: 0, paid: 0, partial: 0, pending: 0 });
  }, [filteredInvoices]);

  const runInvoiceDownload = () => {
    if (!selectedInvoice) return;
    downloadSupplyInvoicePdf(selectedInvoice, profile);
  };

  const runInvoicePrint = () => {
    if (!selectedInvoice) return;
    printInvoice(buildInvoiceHtml(selectedInvoice, profile));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Review supplier invoices, track payment status, and work with invoice-only reporting in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice number, partner, product..."
            className="w-full sm:w-80"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="partial">Part Paid</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="shadow-soft"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Invoices</p><p className="mt-1 text-2xl font-display font-bold">{filteredInvoices.length}</p><p className="mt-1 text-xs text-muted-foreground">Current filtered records</p></CardContent></Card>
        <Card className="shadow-soft"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Value</p><p className="mt-1 text-2xl font-display font-bold">{profile.currencySymbol || symbolForCurrency(profile.currency)}{totals.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p><p className="mt-1 text-xs text-muted-foreground">Across filtered invoices</p></CardContent></Card>
        <Card className="shadow-soft"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Paid</p><p className="mt-1 text-2xl font-display font-bold">{profile.currencySymbol || symbolForCurrency(profile.currency)}{totals.paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p><p className="mt-1 text-xs text-muted-foreground">Invoices marked paid</p></CardContent></Card>
        <Card className="shadow-soft"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Outstanding</p><p className="mt-1 text-2xl font-display font-bold">{profile.currencySymbol || symbolForCurrency(profile.currency)}{(totals.pending + totals.partial).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p><p className="mt-1 text-xs text-muted-foreground">Pending and part-paid invoices</p></CardContent></Card>
      </div>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="text-base font-display">Invoice Register</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {filteredInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices match this filter yet.</p>
          ) : filteredInvoices.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-border p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{entry.invoiceNumber}</p>
                    <Badge variant={entry.direction === "incoming" ? "default" : "secondary"}>
                      {entry.direction === "incoming" ? "Purchase" : "Supply Sale"}
                    </Badge>
                    <Badge variant="outline">{paymentStatusLabel(entry.paymentStatus)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{entry.partnerName} - {entry.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSupplyDate(entry.movementDate)} {entry.movementTime} | Recorded {formatSupplyDateTime(entry.recordedAt)}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="text-left sm:text-right">
                    <p className="font-display text-lg font-semibold">
                      {symbolForCurrency(entry.currency)}{invoiceAmount(entry).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Cost {symbolForCurrency(entry.currency)}{invoiceCostAmount(entry).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>

                  <select
                    value={entry.paymentStatus}
                    onChange={(e) => updateSupplyEntry(entry.id, { paymentStatus: e.target.value as typeof entry.paymentStatus })}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="pending">Pending</option>
                    <option value="partial">Part Paid</option>
                    <option value="paid">Paid</option>
                  </select>

                  <Button variant="outline" onClick={() => setSelectedInvoiceId(entry.id)}>
                    <FileText className="mr-2 h-4 w-4" /> Open
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!selectedInvoice} onOpenChange={(open) => { if (!open) setSelectedInvoiceId(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-display">Invoice Preview</DialogTitle>
            <DialogDescription>
              Print, download, and review payment status from the invoice center.
            </DialogDescription>
          </DialogHeader>

          {selectedInvoice ? (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
                <div className="bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--primary)))] p-6 text-primary-foreground">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-primary-foreground/80">{invoiceTypeLabel(selectedInvoice.direction)}</p>
                      <h3 className="mt-3 font-display text-3xl font-bold">{profile.name || "Verifin"}</h3>
                      <p className="mt-2 max-w-xl text-sm text-primary-foreground/80">Invoice center preview for supplier-side sales and stock receipts.</p>
                    </div>
                    <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
                      <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/70">Invoice</p>
                      <p className="mt-2 text-lg font-semibold">{selectedInvoice.invoiceNumber}</p>
                      <Badge variant="secondary" className="mt-3 border-transparent bg-white/15 text-primary-foreground hover:bg-white/15">
                        {paymentStatusLabel(selectedInvoice.paymentStatus)}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="space-y-6 p-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-muted/30 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Partner</p>
                      <p className="mt-2 text-lg font-semibold">{selectedInvoice.partnerName}</p>
                      <p className="mt-1 text-sm text-muted-foreground capitalize">{selectedInvoice.partnerCategory}</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-muted/30 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Timeline</p>
                      <p className="mt-2 text-lg font-semibold">{formatSupplyDate(selectedInvoice.movementDate)} at {selectedInvoice.movementTime}</p>
                      <p className="mt-1 text-sm text-muted-foreground">Recorded {formatSupplyDateTime(selectedInvoice.recordedAt)}</p>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="p-3 text-left font-medium text-muted-foreground">Product</th>
                          <th className="p-3 text-left font-medium text-muted-foreground">Qty</th>
                          <th className="p-3 text-left font-medium text-muted-foreground">Unit Price</th>
                          <th className="p-3 text-left font-medium text-muted-foreground">Unit Cost</th>
                          <th className="p-3 text-right font-medium text-muted-foreground">Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-border">
                          <td className="p-3 font-medium">{selectedInvoice.productName}</td>
                          <td className="p-3">{selectedInvoice.quantity}</td>
                          <td className="p-3">{symbolForCurrency(selectedInvoice.currency)}{selectedInvoice.unitPrice.toFixed(2)}</td>
                          <td className="p-3">{symbolForCurrency(selectedInvoice.currency)}{selectedInvoice.unitCost.toFixed(2)}</td>
                          <td className="p-3 text-right font-semibold">{symbolForCurrency(selectedInvoice.currency)}{invoiceAmount(selectedInvoice).toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-2xl border border-border bg-muted/20 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Notes</p>
                      <p className="mt-3 text-sm leading-6 text-foreground/90">{selectedInvoice.notes?.trim() || "No extra notes recorded for this invoice."}</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between border-b border-border pb-3 text-sm">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-semibold">{symbolForCurrency(selectedInvoice.currency)}{invoiceAmount(selectedInvoice).toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between border-b border-border py-3 text-sm">
                        <span className="text-muted-foreground">Total Cost</span>
                        <span className="font-semibold">{symbolForCurrency(selectedInvoice.currency)}{invoiceCostAmount(selectedInvoice).toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between pt-4">
                        <span className="font-medium">Invoice Total</span>
                        <span className="font-display text-2xl font-bold">{symbolForCurrency(selectedInvoice.currency)}{invoiceAmount(selectedInvoice).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <select
                  value={selectedInvoice.paymentStatus}
                  onChange={(e) => updateSupplyEntry(selectedInvoice.id, { paymentStatus: e.target.value as typeof selectedInvoice.paymentStatus })}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="pending">Pending</option>
                  <option value="partial">Part Paid</option>
                  <option value="paid">Paid</option>
                </select>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={runInvoicePrint}>
                    <Printer className="mr-2 h-4 w-4" /> Print
                  </Button>
                  <Button variant="outline" onClick={runInvoiceDownload}>
                    <Download className="mr-2 h-4 w-4" /> Download
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Invoices;
