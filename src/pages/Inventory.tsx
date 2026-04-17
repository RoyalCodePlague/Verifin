import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Plus, Package, Edit2, Trash2, ScanBarcode, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AdminAssistant } from "@/components/dashboard/AdminAssistant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { createProductApi, deleteProductApi, updateProductApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { toast } from "sonner";

const allCategories = [
  "Groceries", "Beverages", "Hardware", "Personal Care", "Electronics",
  "Clothing", "Stationery", "Cleaning", "Snacks", "Dairy",
  "Bakery", "Frozen Foods", "Health & Beauty", "Tools", "Other"
];

const Inventory = () => {
  const { products, deleteProduct, profile, addActivity } = useStore();
  const { refreshUser } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [addOpen, setAddOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", stock: "", reorder: "", price: "", barcode: "" });
  const [saving, setSaving] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const sym = profile.currencySymbol || "R";

  const mergedCategories = Array.from(new Set([...profile.categories, ...allCategories]));
  const categories = ["All", ...mergedCategories];

  const filtered = products.filter(
    (p) => (category === "All" || p.category === category) && 
    (p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()) || (p.barcode || "").includes(search))
  );

  const openAdd = () => {
    setForm({ name: "", category: mergedCategories[0] || "", stock: "", reorder: "5", price: "", barcode: "" });
    setAddOpen(true);
  };

  const openEdit = (id: string) => {
    const p = products.find(x => x.id === id);
    if (!p) return;
    setForm({ name: p.name, category: p.category, stock: String(p.stock), reorder: String(p.reorder), price: String(p.price), barcode: p.barcode || "" });
    setEditProduct(id);
  };

  const generateSku = (name: string, cat: string) => {
    const prefix = cat.substring(0, 3).toUpperCase();
    const suffix = String(products.length + 1).padStart(3, "0");
    return `${prefix}${suffix}`;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editProduct) {
        await updateProductApi(editProduct, {
          name: form.name,
          categoryName: form.category,
          stock: parseInt(form.stock) || 0,
          reorder_level: parseInt(form.reorder) || 5,
          price: parseFloat(form.price) || 0,
          barcode: form.barcode,
        });
        setEditProduct(null);
        toast.success("Product updated!");
        await refreshUser();
      } else {
        const sku = generateSku(form.name, form.category);
        await createProductApi({
          name: form.name,
          sku,
          categoryName: form.category,
          stock: parseInt(form.stock) || 0,
          reorder_level: parseInt(form.reorder) || 5,
          price: parseFloat(form.price) || 0,
          barcode: form.barcode,
        });
        setAddOpen(false);
        setShowAssistant(true);
        addActivity({ text: `Added product: ${form.name}`, time: "Just now", type: "restock" });
        toast.success("Product added!");
        await refreshUser();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save product");
    } finally {
      setSaving(false);
    }
  };

  const handleBarcodeDetected = (code: string) => {
    const found = products.find(p => p.barcode === code);
    if (found) {
      toast.info(`Found: ${found.name} (Stock: ${found.stock})`);
      setSearch(found.name);
    } else {
      toast.info(`New barcode: ${code}. Fill in the product details and save.`);
      setForm({ name: "", category: mergedCategories[0] || "", stock: "", reorder: "5", price: "", barcode: code });
      setAddOpen(true);
    }
    setScanOpen(false);
  };

  const formDialog = (
    <DialogContent>
      <DialogHeader><DialogTitle className="font-display">{editProduct ? "Edit Product" : "Add Product"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>Product Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1" placeholder="e.g. White Bread Loaf" /></div>
        <div>
          <Label>Category</Label>
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            {mergedCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div><Label>Stock</Label><Input type="number" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} className="mt-1" /></div>
          <div><Label>Reorder At</Label><Input type="number" value={form.reorder} onChange={e => setForm({ ...form, reorder: e.target.value })} className="mt-1" /></div>
          <div><Label>Price ({sym})</Label><Input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="mt-1" /></div>
        </div>
        <div>
          <Label>Barcode <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} className="mt-1" placeholder="Scan or enter manually" />
          <p className="text-xs text-muted-foreground mt-1">Adding a barcode helps with faster scanning during audits and sales.</p>
        </div>
        {!editProduct && (
          <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-lg">SKU will be generated automatically.</p>
        )}
        <Button onClick={handleSave} disabled={!form.name.trim() || saving} className="w-full bg-gradient-hero text-primary-foreground">{saving ? "Saving…" : editProduct ? "Update" : "Add"} Product</Button>
      </div>
    </DialogContent>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search products, SKU, barcode..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setScanOpen(true)}><ScanBarcode className="h-4 w-4 mr-2" /> Scan</Button>
          <Button onClick={openAdd} className="bg-gradient-hero text-primary-foreground"><Plus className="h-4 w-4 mr-2" /> Add Product</Button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button key={c} onClick={() => setCategory(c)} className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${category === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>{c}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="No products found" description={search ? "Try a different search term" : "Add your first product to get started"} actionLabel="Add Product" onAction={openAdd} />
      ) : (
        <Card className="shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 font-medium text-muted-foreground">Product</th>
                  <th className="text-left p-3 font-medium text-muted-foreground hidden sm:table-cell">SKU</th>
                  <th className="text-left p-3 font-medium text-muted-foreground hidden md:table-cell">Category</th>
                  <th className="text-center p-3 font-medium text-muted-foreground">Stock</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Price</th>
                  <th className="text-center p-3 font-medium text-muted-foreground hidden md:table-cell">Added</th>
                  <th className="text-center p-3 font-medium text-muted-foreground hidden lg:table-cell">Restocked</th>
                  <th className="text-center p-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-center p-3 font-medium text-muted-foreground w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      <p className="font-medium">{p.name}</p>
                      {p.barcode && <p className="text-[10px] text-muted-foreground">{p.barcode}</p>}
                    </td>
                    <td className="p-3 text-muted-foreground hidden sm:table-cell">{p.sku}</td>
                    <td className="p-3 text-muted-foreground hidden md:table-cell">{p.category}</td>
                    <td className="p-3 text-center">{p.stock}</td>
                    <td className="p-3 text-right">{sym}{p.price.toFixed(2)}</td>
                    <td className="p-3 text-center hidden md:table-cell">
                      <span className="text-xs text-muted-foreground">{p.addedDate || "N/A"}</span>
                    </td>
                    <td className="p-3 text-center hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {p.lastRestocked || "N/A"}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <Badge variant={p.status === "ok" ? "default" : p.status === "low" ? "secondary" : "destructive"} className={p.status === "ok" ? "bg-success/10 text-success hover:bg-success/10" : p.status === "low" ? "bg-warning/10 text-warning hover:bg-warning/10" : "bg-destructive/10 text-destructive hover:bg-destructive/10"}>
                        {p.status === "ok" ? "In Stock" : p.status === "low" ? "Low" : "Out"}
                      </Badge>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => openEdit(p.id)} className="p-1.5 rounded hover:bg-muted"><Edit2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        <button onClick={() => setDeleteId(p.id)} className="p-1.5 rounded hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showAssistant && (
        <Card className="shadow-soft border-primary/20">
          <CardContent className="p-4 lg:p-5">
            <p className="text-sm font-medium text-muted-foreground mb-2">Auto Admin Assistant — next steps for your stock</p>
            <AdminAssistant autoExpand onDismissAutoExpand={() => setShowAssistant(false)} />
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>{formDialog}</Dialog>
      <Dialog open={!!editProduct} onOpenChange={() => setEditProduct(null)}>{formDialog}</Dialog>
      <ConfirmationModal
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Delete Product"
        description="This will permanently remove this product."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!deleteId) return;
          try {
            await deleteProductApi(deleteId);
            deleteProduct(deleteId);
            toast.success("Product removed");
            await refreshUser();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Delete failed");
          }
          setDeleteId(null);
        }}
      />
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleBarcodeDetected} />
    </div>
  );
};

export default Inventory;
