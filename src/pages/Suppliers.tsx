import { useEffect, useMemo, useState } from "react";
import { PackagePlus, Plus, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

type Suggestion = Awaited<ReturnType<typeof fetchPurchaseSuggestions>>["items"][number];

const emptySupplier = { name: "", contact_name: "", phone: "", email: "", address: "", notes: "" };

const Suppliers = () => {
  const { products, branches, profile } = useStore();
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [orders, setOrders] = useState<ApiPurchaseOrder[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [supplierForm, setSupplierForm] = useState(emptySupplier);
  const [orderForm, setOrderForm] = useState({ supplier: "", branch: "", product: "", quantity: "1", unitCost: "", expectedDate: "" });
  const sym = profile.currencySymbol || "R";

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

  const selectedProduct = useMemo(() => products.find(p => p.id === orderForm.product), [orderForm.product, products]);

  const saveSupplier = async () => {
    try {
      const created = await createSupplierApi(supplierForm);
      setSuppliers(prev => [created, ...prev]);
      setSupplierForm(emptySupplier);
      setSupplierOpen(false);
      toast.success("Supplier added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add supplier");
    }
  };

  const createOrder = async () => {
    if (!orderForm.supplier || !orderForm.product) return;
    try {
      const created = await createPurchaseOrderApi({
        supplier: Number(orderForm.supplier),
        branch: orderForm.branch ? Number(orderForm.branch) : null,
        expected_date: orderForm.expectedDate || null,
        status: "ordered",
        items: [{
          product: Number(orderForm.product),
          quantity_ordered: Number(orderForm.quantity) || 1,
          quantity_received: 0,
          unit_cost: (Number(orderForm.unitCost) || selectedProduct?.costPrice || 0).toFixed(2),
        }],
      });
      setOrders(prev => [created, ...prev]);
      setOrderOpen(false);
      toast.success("Purchase order created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create purchase order");
    }
  };

  const receiveOrder = async (order: ApiPurchaseOrder) => {
    try {
      const updated = await receivePurchaseOrderApi(order.id);
      setOrders(prev => prev.map(item => item.id === updated.id ? updated : item));
      toast.success("Stock received and inventory updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not receive order");
    }
  };

  const startSuggestionOrder = (item: Suggestion) => {
    setOrderForm({
      supplier: item.supplier ? String(item.supplier.id) : "",
      branch: item.product.branch ? String(item.product.branch) : "",
      product: String(item.product.id),
      quantity: String(item.suggested_quantity || 1),
      unitCost: item.product.cost_price || "0",
      expectedDate: "",
    });
    setOrderOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage suppliers, purchase orders, and reorder suggestions.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSupplierOpen(true)}><Plus className="h-4 w-4 mr-2" /> Supplier</Button>
          <Button onClick={() => setOrderOpen(true)} className="bg-gradient-hero text-primary-foreground"><PackagePlus className="h-4 w-4 mr-2" /> Purchase Order</Button>
        </div>
      </div>

      <Card className="shadow-soft">
        <CardHeader><CardTitle className="text-base font-display">Low-Stock Purchase Suggestions</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {suggestions.length === 0 ? <p className="text-sm text-muted-foreground">No purchase suggestions right now.</p> : suggestions.map(item => (
            <div key={item.product.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{item.product.name}</p>
              <p className="text-xs text-muted-foreground">{item.product.branch_name || "Main"} - {item.product.stock} in stock</p>
              <p className="text-sm mt-2">Suggested: <span className="font-semibold">{item.suggested_quantity}</span></p>
              <p className="text-xs text-muted-foreground">Supplier: {item.supplier?.name || "Not assigned"}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => startSuggestionOrder(item)}>Create PO</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="shadow-soft">
          <CardHeader><CardTitle className="text-base font-display flex items-center gap-2"><Truck className="h-4 w-4" /> Suppliers</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {suppliers.map(supplier => (
              <div key={supplier.id} className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{supplier.name}</p>
                <p className="text-xs text-muted-foreground">{[supplier.contact_name, supplier.phone, supplier.email].filter(Boolean).join(" - ") || "No contact details"}</p>
              </div>
            ))}
            {suppliers.length === 0 && <p className="text-sm text-muted-foreground">Add suppliers to connect purchase orders to real vendors.</p>}
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader><CardTitle className="text-base font-display">Purchase Orders</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {orders.map(order => (
              <div key={order.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{order.order_number} - {order.supplier_name}</p>
                    <p className="text-xs text-muted-foreground">{order.items.length} item(s) - {sym}{Number(order.total_cost).toLocaleString()}</p>
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

      <Dialog open={supplierOpen} onOpenChange={setSupplierOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display">Add Supplier</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={supplierForm.name} onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })} className="mt-1" /></div>
            <div><Label>Contact Person</Label><Input value={supplierForm.contact_name} onChange={e => setSupplierForm({ ...supplierForm, contact_name: e.target.value })} className="mt-1" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Phone</Label><Input value={supplierForm.phone} onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })} className="mt-1" /></div>
              <div><Label>Email</Label><Input value={supplierForm.email} onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })} className="mt-1" /></div>
            </div>
            <Button onClick={saveSupplier} disabled={!supplierForm.name.trim()} className="w-full">Save Supplier</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display">Create Purchase Order</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Supplier</Label><select value={orderForm.supplier} onChange={e => setOrderForm({ ...orderForm, supplier: e.target.value })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="">Select supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><Label>Branch</Label><select value={orderForm.branch} onChange={e => setOrderForm({ ...orderForm, branch: e.target.value })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="">No branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            <div><Label>Product</Label><select value={orderForm.product} onChange={e => { const product = products.find(p => p.id === e.target.value); setOrderForm({ ...orderForm, product: e.target.value, unitCost: String(product?.costPrice || "") }); }} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="">Select product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Quantity</Label><Input type="number" value={orderForm.quantity} onChange={e => setOrderForm({ ...orderForm, quantity: e.target.value })} className="mt-1" /></div>
              <div><Label>Unit Cost</Label><Input type="number" value={orderForm.unitCost} onChange={e => setOrderForm({ ...orderForm, unitCost: e.target.value })} className="mt-1" /></div>
              <div><Label>Expected</Label><Input type="date" value={orderForm.expectedDate} onChange={e => setOrderForm({ ...orderForm, expectedDate: e.target.value })} className="mt-1" /></div>
            </div>
            <Button onClick={createOrder} disabled={!orderForm.supplier || !orderForm.product} className="w-full">Create Order</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Suppliers;
