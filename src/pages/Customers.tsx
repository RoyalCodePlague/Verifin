import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Plus, Trash2, Users, QrCode, Gift, Edit2, Award, Star, Trophy, Crown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useStore, CustomerBadge } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

const badgeConfig: Record<CustomerBadge, { label: string; color: string; icon: typeof Award }> = {
  bronze: { label: "Bronze", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", icon: Award },
  silver: { label: "Silver", color: "bg-muted text-muted-foreground", icon: Star },
  gold: { label: "Gold", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: Trophy },
  platinum: { label: "Platinum", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400", icon: Crown },
};

const Customers = () => {
  const { customers, addCustomer, updateCustomer, deleteCustomer, profile } = useStore();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewQR, setViewQR] = useState<string | null>(null);
  const [creditModal, setCreditModal] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", badge: "bronze" as CustomerBadge });
  const qrWrapperRef = useRef<HTMLDivElement | null>(null);
  const sym = profile.currencySymbol || "R";

  const filtered = customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search));
  const viewingCustomer = customers.find(c => c.id === viewQR);
  const creditCustomer = customers.find(c => c.id === creditModal);

  const openAdd = () => {
    setForm({ name: "", phone: "", badge: "bronze" });
    setAddOpen(true);
  };

  const openEdit = (id: string) => {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    setForm({ name: c.name, phone: c.phone, badge: c.badge || "bronze" });
    setEditId(id);
  };

  const handleSave = () => {
    if (editId) {
      updateCustomer(editId, { name: form.name, phone: form.phone, badge: form.badge });
      setEditId(null);
      toast.success("Customer updated!");
    } else {
      const qrCode = `VRF-CUST-${Date.now().toString(36).toUpperCase()}`;
      addCustomer({ name: form.name, phone: form.phone, totalSpent: 0, visits: 0, loyaltyPoints: 0, qrCode, credits: 0, lastVisit: "Never", badge: form.badge });
      setAddOpen(false);
      toast.success("Customer added with QR code!");
    }
    setForm({ name: "", phone: "", badge: "bronze" });
  };

  const handleAddCredit = () => {
    if (creditModal && creditAmount) {
      const amount = parseFloat(creditAmount);
      if (!isNaN(amount) && amount > 0) {
        const c = customers.find(x => x.id === creditModal);
        if (c) {
          updateCustomer(creditModal, { credits: (c.credits || 0) + amount });
          toast.success(`${sym}${amount} credit added to ${c.name}!`);
        }
      }
    }
    setCreditAmount("");
    setCreditModal(null);
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

  const formDialog = (
    <DialogContent>
      <DialogHeader><DialogTitle className="font-display">{editId ? "Edit Customer" : "Add Customer"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>Customer Name</Label><Input placeholder="e.g. John's Hardware" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1" /></div>
        <div><Label>Phone Number</Label><Input placeholder="+27 82 555 0101" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="mt-1" /></div>
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

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet" description="Add your first customer to start tracking" actionLabel="Add Customer" onAction={openAdd} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {filtered.map((c) => {
            const badge = badgeConfig[c.badge || "bronze"];
            const BadgeIcon = badge.icon;
            return (
              <Card key={c.id} className="shadow-soft group cursor-pointer hover:shadow-elevated transition-shadow" onClick={() => openEdit(c.id)}>
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
                      <button aria-label="Delete customer" onClick={() => setDeleteId(c.id)} className="p-1.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-3 text-xs">
                    <div><strong className="font-display">{sym}{c.totalSpent.toLocaleString()}</strong><br /><span className="text-muted-foreground">spent</span></div>
                    <div><strong className="font-display">{c.visits}</strong><br /><span className="text-muted-foreground">visits</span></div>
                    <div><strong className="font-display">{c.loyaltyPoints}</strong><br /><span className="text-muted-foreground">points</span></div>
                    <div><strong className="font-display text-success">{sym}{(c.credits || 0).toFixed(2)}</strong><br /><span className="text-muted-foreground">credits</span></div>
                  </div>
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
          <DialogHeader><DialogTitle className="font-display">Customer QR Code</DialogTitle></DialogHeader>
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
              <p className="text-xs text-muted-foreground">Print or share this QR code with the customer.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Credit Dialog */}
      <Dialog open={!!creditModal} onOpenChange={() => setCreditModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display">Add Credit / Reward</DialogTitle></DialogHeader>
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

      <ConfirmationModal open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Delete Customer" description="Remove this customer?" confirmLabel="Delete" variant="destructive" onConfirm={() => { if (deleteId) deleteCustomer(deleteId); setDeleteId(null); }} />
    </div>
  );
};

export default Customers;
