import type { BusinessProfile, SupplyEntry } from "@/lib/store";
import { symbolForCurrency } from "@/lib/currency";
import { jsPDF } from "jspdf";

export function formatSupplyDate(date: string) {
  if (!date) return "Not set";
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatSupplyDateTime(iso: string) {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
}

export function paymentStatusLabel(status: SupplyEntry["paymentStatus"]) {
  if (status === "paid") return "Paid";
  if (status === "partial") return "Part Paid";
  return "Pending";
}

export function invoiceTypeLabel(direction: SupplyEntry["direction"]) {
  return direction === "incoming" ? "Stock Received" : "Stock Supplied";
}

export function invoiceAmount(entry: SupplyEntry) {
  return entry.quantity * entry.unitPrice;
}

export function invoiceCostAmount(entry: SupplyEntry) {
  return entry.quantity * entry.unitCost;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildInvoiceHtml(entry: SupplyEntry, profile: BusinessProfile) {
  const currencySymbol = symbolForCurrency(entry.currency);
  const total = invoiceAmount(entry).toFixed(2);
  const totalCost = invoiceCostAmount(entry).toFixed(2);
  const businessName = profile.name || "Verifin";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(entry.invoiceNumber)}</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #14213d;
        --muted: #5c677d;
        --line: #d8dee9;
        --soft: #f7f3eb;
        --accent: #d97706;
        --accent-dark: #92400e;
        --card: #ffffff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: linear-gradient(180deg, #fffaf2 0%, #f4efe7 100%);
        color: var(--ink);
        font-family: "Segoe UI", Arial, sans-serif;
      }
      .page {
        max-width: 920px;
        margin: 0 auto;
        padding: 40px 24px;
      }
      .invoice {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 24px;
        overflow: hidden;
        box-shadow: 0 28px 60px rgba(20, 33, 61, 0.12);
      }
      .hero {
        padding: 32px;
        background:
          radial-gradient(circle at top right, rgba(255,255,255,0.28), transparent 32%),
          linear-gradient(135deg, var(--ink), #243b6b 58%, #31558d 100%);
        color: #fff;
      }
      .hero-top, .grid, .totals {
        display: grid;
        gap: 16px;
      }
      .hero-top {
        grid-template-columns: 1.3fr 1fr;
        align-items: start;
      }
      .eyebrow {
        display: inline-block;
        padding: 7px 12px;
        border-radius: 999px;
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.18);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 14px 0 8px;
        font-size: 34px;
        line-height: 1.05;
      }
      .subtle {
        color: rgba(255,255,255,0.8);
        font-size: 14px;
      }
      .hero-card {
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 18px;
        padding: 18px;
      }
      .body {
        padding: 28px 32px 32px;
      }
      .grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .panel {
        background: var(--soft);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
      }
      .label {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .value {
        margin-top: 8px;
        font-size: 18px;
        font-weight: 700;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 24px;
      }
      th, td {
        padding: 14px 12px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        font-size: 14px;
      }
      th {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .totals {
        margin-top: 24px;
        grid-template-columns: 1.15fr 0.85fr;
        align-items: start;
      }
      .note-box {
        min-height: 120px;
      }
      .totals-card {
        border: 1px solid var(--line);
        border-radius: 18px;
        overflow: hidden;
      }
      .total-row {
        display: flex;
        justify-content: space-between;
        padding: 14px 16px;
        font-size: 14px;
      }
      .total-row + .total-row { border-top: 1px solid var(--line); }
      .total-row:last-child {
        background: linear-gradient(135deg, #fff4dd, #ffe7ba);
        font-size: 18px;
        font-weight: 700;
      }
      .footer {
        margin-top: 26px;
        display: flex;
        justify-content: space-between;
        gap: 16px;
        color: var(--muted);
        font-size: 13px;
      }
      @media print {
        body { background: #fff; }
        .page { padding: 0; }
        .invoice { box-shadow: none; border-radius: 0; }
      }
      @media (max-width: 700px) {
        .hero-top, .grid, .totals { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="invoice">
        <div class="hero">
          <div class="hero-top">
            <div>
              <span class="eyebrow">${escapeHtml(invoiceTypeLabel(entry.direction))}</span>
              <h1>${escapeHtml(businessName)}</h1>
              <div class="subtle">Supply invoice for inventory movement and stock tracking</div>
            </div>
            <div class="hero-card">
              <div class="label">Invoice Number</div>
              <div class="value">${escapeHtml(entry.invoiceNumber)}</div>
              <div class="subtle" style="margin-top: 10px;">Status: ${escapeHtml(paymentStatusLabel(entry.paymentStatus))}</div>
            </div>
          </div>
        </div>
        <div class="body">
          <div class="grid">
            <div class="panel">
              <div class="label">Partner</div>
              <div class="value">${escapeHtml(entry.partnerName)}</div>
              <div style="margin-top: 8px; color: var(--muted); font-size: 14px;">${escapeHtml(entry.partnerCategory)}</div>
            </div>
            <div class="panel">
              <div class="label">Dates</div>
              <div class="value">${escapeHtml(formatSupplyDate(entry.movementDate))} ${escapeHtml(entry.movementTime)}</div>
              <div style="margin-top: 8px; color: var(--muted); font-size: 14px;">Recorded ${escapeHtml(formatSupplyDateTime(entry.recordedAt))}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Unit Cost</th>
                <th>Line Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${escapeHtml(entry.productName)}</td>
                <td>${entry.quantity}</td>
                <td>${currencySymbol}${entry.unitPrice.toFixed(2)}</td>
                <td>${currencySymbol}${entry.unitCost.toFixed(2)}</td>
                <td>${currencySymbol}${total}</td>
              </tr>
            </tbody>
          </table>

          <div class="totals">
            <div class="panel note-box">
              <div class="label">Notes</div>
              <div style="margin-top: 10px; font-size: 15px; line-height: 1.6;">
                ${escapeHtml(entry.notes?.trim() || "No extra notes recorded for this invoice.")}
              </div>
            </div>
            <div class="totals-card">
              <div class="total-row"><span>Subtotal</span><strong>${currencySymbol}${total}</strong></div>
              <div class="total-row"><span>Total Cost</span><strong>${currencySymbol}${totalCost}</strong></div>
              <div class="total-row"><span>Invoice Total</span><strong>${currencySymbol}${total}</strong></div>
            </div>
          </div>

          <div class="footer">
            <div>Generated by Verifin invoice workspace</div>
            <div>${escapeHtml(profile.currency)} base currency</div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export function downloadSupplyInvoicePdf(entry: SupplyEntry, profile: BusinessProfile) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  const brand = profile.name || "Verifin";
  const currencySymbol = symbolForCurrency(entry.currency);
  const total = invoiceAmount(entry);
  const totalCost = invoiceCostAmount(entry);

  doc.setFillColor(20, 33, 61);
  doc.rect(0, 0, pageWidth, 180, "F");
  doc.setFillColor(217, 119, 6);
  doc.circle(pageWidth - 76, 56, 58, "F");
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(pageWidth - 210, 40, 150, 82, 18, 18, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(invoiceTypeLabel(entry.direction).toUpperCase(), margin, 40);
  doc.setFontSize(28);
  doc.text(brand, margin, 76);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Supply invoice for inventory movement and stock tracking", margin, 98);

  doc.setTextColor(20, 33, 61);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("INVOICE", pageWidth - 190, 64);
  doc.setFontSize(16);
  doc.text(entry.invoiceNumber, pageWidth - 190, 88);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Status: ${paymentStatusLabel(entry.paymentStatus)}`, pageWidth - 190, 108);

  let y = 210;
  const boxGap = 16;
  const boxWidth = (contentWidth - boxGap) / 2;

  const drawInfoBox = (x: number, title: string, lines: string[]) => {
    doc.setDrawColor(216, 222, 233);
    doc.setFillColor(247, 243, 235);
    doc.roundedRect(x, y, boxWidth, 78, 18, 18, "FD");
    doc.setTextColor(92, 103, 125);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(title.toUpperCase(), x + 16, y + 20);
    doc.setTextColor(20, 33, 61);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(lines[0] || "", x + 16, y + 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    lines.slice(1).forEach((line, index) => {
      doc.text(line, x + 16, y + 60 + index * 14);
    });
  };

  drawInfoBox(margin, "Partner", [
    entry.partnerName,
    entry.partnerCategory.charAt(0).toUpperCase() + entry.partnerCategory.slice(1),
  ]);
  drawInfoBox(margin + boxWidth + boxGap, "Dates", [
    `${formatSupplyDate(entry.movementDate)} ${entry.movementTime}`,
    `Recorded ${formatSupplyDateTime(entry.recordedAt)}`,
  ]);

  y += 108;
  doc.setDrawColor(216, 222, 233);
  doc.roundedRect(margin, y, contentWidth, 98, 18, 18, "S");

  const columns = [
    { label: "Product", x: margin + 16 },
    { label: "Qty", x: margin + 240 },
    { label: "Unit Price", x: margin + 300 },
    { label: "Unit Cost", x: margin + 390 },
    { label: "Line Total", x: margin + 490 },
  ];

  doc.setTextColor(92, 103, 125);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  columns.forEach((column) => doc.text(column.label.toUpperCase(), column.x, y + 22));
  doc.setDrawColor(216, 222, 233);
  doc.line(margin, y + 34, margin + contentWidth, y + 34);

  doc.setTextColor(20, 33, 61);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(entry.productName, columns[0].x, y + 58);
  doc.setFont("helvetica", "normal");
  doc.text(String(entry.quantity), columns[1].x, y + 58);
  doc.text(`${currencySymbol}${entry.unitPrice.toFixed(2)}`, columns[2].x, y + 58);
  doc.text(`${currencySymbol}${entry.unitCost.toFixed(2)}`, columns[3].x, y + 58);
  doc.setFont("helvetica", "bold");
  doc.text(`${currencySymbol}${total.toFixed(2)}`, columns[4].x, y + 58);

  y += 126;
  const notesWidth = contentWidth * 0.57;
  const totalsWidth = contentWidth - notesWidth - boxGap;
  const notesHeight = 132;

  doc.setFillColor(247, 243, 235);
  doc.setDrawColor(216, 222, 233);
  doc.roundedRect(margin, y, notesWidth, notesHeight, 18, 18, "FD");
  doc.setTextColor(92, 103, 125);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("NOTES", margin + 16, y + 20);
  doc.setTextColor(20, 33, 61);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const noteLines = doc.splitTextToSize(entry.notes?.trim() || "No extra notes recorded for this invoice.", notesWidth - 32);
  doc.text(noteLines, margin + 16, y + 42);

  const totalsX = margin + notesWidth + boxGap;
  doc.roundedRect(totalsX, y, totalsWidth, notesHeight, 18, 18, "S");
  const totalRows = [
    ["Subtotal", `${currencySymbol}${total.toFixed(2)}`],
    ["Total Cost", `${currencySymbol}${totalCost.toFixed(2)}`],
    ["Invoice Total", `${currencySymbol}${total.toFixed(2)}`],
  ];
  totalRows.forEach((row, index) => {
    const rowY = y + index * 38;
    if (index === 2) {
      doc.setFillColor(255, 244, 221);
      doc.roundedRect(totalsX + 1, rowY + 1, totalsWidth - 2, 36, 0, 0, "F");
    }
    if (index > 0) doc.line(totalsX, rowY, totalsX + totalsWidth, rowY);
    doc.setTextColor(92, 103, 125);
    doc.setFont("helvetica", index === 2 ? "bold" : "normal");
    doc.setFontSize(index === 2 ? 12 : 10);
    doc.text(row[0], totalsX + 16, rowY + 24);
    doc.setTextColor(20, 33, 61);
    doc.text(row[1], totalsX + totalsWidth - 16, rowY + 24, { align: "right" });
  });

  doc.setTextColor(92, 103, 125);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Generated by Verifin invoice workspace", margin, pageHeight - 28);
  doc.text(`${profile.currency} base currency`, pageWidth - margin, pageHeight - 28, { align: "right" });

  doc.save(`${entry.invoiceNumber}.pdf`);
}
