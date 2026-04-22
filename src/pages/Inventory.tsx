import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, Plus, Package, Edit2, Trash2, ScanBarcode, Calendar, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { createProductApi, deleteProductApi, fetchInventoryForecast, identifyBarcodeProductApi, mapProductResponse, updateProductApi, type ApiForecastItem } from "@/lib/api";
import { addToOfflineQueue, canQueueOfflineAction } from "@/lib/offlineQueue";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { toast } from "sonner";
import { useFeatureAccess, useUpgradePrompt } from "@/lib/features";
import { symbolForCurrency } from "@/lib/currency";
import { cacheBarcodeEntry, getCachedBarcodeEntry } from "@/lib/barcodeCache";

const allCategories = [
  "Groceries", "Beverages", "Hardware", "Personal Care", "Electronics",
  "Clothing", "Stationery", "Cleaning", "Snacks", "Dairy",
  "Bakery", "Frozen Foods", "Health & Beauty", "Tools", "Other"
];

function forecastRiskMeta(risk: ApiForecastItem["risk"], horizonDays: number, daysRemaining: number | null) {
  if (risk === "stockout") {
    return {
      label: "Out of stock",
      badgeClass: "bg-destructive/10 text-destructive hover:bg-destructive/10",
      description: "This item already needs restocking.",
    };
  }
  if (risk === "high") {
    return {
      label: "Restock soon",
      badgeClass: "bg-warning/10 text-warning hover:bg-warning/10",
      description: daysRemaining == null
        ? `Expected to run low within ${horizonDays} days.`
        : `Projected to run low in about ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`,
    };
  }
  return {
    label: "Stable",
    badgeClass: "bg-success/10 text-success hover:bg-success/10",
    description: "Stock level looks okay for the current forecast window.",
  };
}

const Inventory = () => {
  const { products, addProduct, upsertProduct, updateProduct, deleteProduct, profile, addActivity } = useStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canUse } = useFeatureAccess();
  const promptUpgrade = useUpgradePrompt();
  const canUseForecasting = canUse("forecasting");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [addOpen, setAddOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", branchId: "", supplierId: "", stock: "", reorder: "", costPrice: "", price: "", barcode: "" });
  const [forecast, setForecast] = useState<ApiForecastItem[]>([]);
  const [forecastHorizon, setForecastHorizon] = useState(7);
  const [saving, setSaving] = useState(false);
  const [canUseCameraScan, setCanUseCameraScan] = useState(false);
  const productNameInputRef = useRef<HTMLInputElement>(null);
  const sym = profile.currencySymbol || "R";
  const secondaryCurrency = profile.enabledCurrencies?.find((code) => code !== profile.currency) || "";
  const secondaryRate = secondaryCurrency ? profile.exchangeRates?.[secondaryCurrency] || 0 : 0;

  const flaggedView = searchParams.get("view") === "flagged";

  const inventoryCostMetaText = (currency?: string, rate?: number) => {
    const sourceCurrency = currency || profile.currency;
    if (sourceCurrency === profile.currency) return "Base cost";
    const sourceSymbol = symbolForCurrency(sourceCurrency);
    return `${sourceCurrency} source | ${sourceSymbol}1 = ${sym}${(rate || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })}`;
  };

  const formatSecondaryCost = (baseAmount: number) => {
    if (!secondaryCurrency || !secondaryRate) return null;
    const converted = baseAmount / secondaryRate;
    return `${symbolForCurrency(secondaryCurrency)}${converted.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const costMetaText = (currency?: string, rate?: number) => {
    const sourceCurrency = currency || profile.currency;
    if (sourceCurrency === profile.currency) return "Base cost";
    const sourceSymbol = symbolForCurrency(sourceCurrency);
    return `${sourceCurrency} source · ${sourceSymbol}1 = ${sym}${(rate || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
  };

  useEffect(() => {
    const updateCameraSupport = () => {
      const mobileOrTablet = window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(max-width: 1024px)").matches;
      setCanUseCameraScan(mobileOrTablet && !!navigator.mediaDevices?.getUserMedia);
    };
    updateCameraSupport();
    window.addEventListener("resize", updateCameraSupport);
    return () => window.removeEventListener("resize", updateCameraSupport);
  }, []);

  useEffect(() => {
    if (!navigator.onLine || !canUseForecasting) {
      setForecast([]);
    } else {
      fetchInventoryForecast(7)
        .then((data) => {
          setForecast(data.items.slice(0, 5));
          setForecastHorizon(data.horizon_days || 7);
        })
        .catch(() => setForecast([]));
    }
  }, [canUseForecasting, products.length]);

  useEffect(() => {
    if (flaggedView) {
      setCategory("All");
      if (!search.trim()) {
        setSearch("");
      }
    }
  }, [flaggedView]);

  useEffect(() => {
    if (!addOpen) return;
    const timeout = window.setTimeout(() => {
      productNameInputRef.current?.focus();
      productNameInputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(timeout);
  }, [addOpen]);

  const mergedCategories = Array.from(new Set([...profile.categories, ...allCategories]));
  const categories = ["All", ...mergedCategories];

  const resolveCategoryForForm = (rawCategory?: string) => {
    const normalized = (rawCategory || "").trim();
    if (!normalized) return mergedCategories[0] || "Other";
    const existing = mergedCategories.find((categoryName) => categoryName.toLowerCase() === normalized.toLowerCase());
    return existing || normalized;
  };

  const filtered = products
    .filter((p) => {
      const matchesCategory = category === "All" || p.category === category;
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()) || (p.barcode || "").includes(search);
      const matchesFlaggedView = !flaggedView || p.status === "low" || p.status === "out" || (p.stock > 0 && p.costPrice * p.stock > 5000);
      return matchesCategory && matchesSearch && matchesFlaggedView;
    })
    .sort((a, b) => {
      if (!flaggedView) return 0;

      const priority = (product: typeof a) => {
        if (product.status === "out") return 0;
        if (product.status === "low") return 1;
        if (product.stock > 0 && product.costPrice * product.stock > 5000) return 2;
        return 3;
      };

      const priorityDiff = priority(a) - priority(b);
      if (priorityDiff !== 0) return priorityDiff;

      const aCostValue = a.stock * (a.costPrice || 0);
      const bCostValue = b.stock * (b.costPrice || 0);
      return bCostValue - aCostValue;
    });
  const selectedEditProduct = editProduct ? products.find((item) => item.id === editProduct) : undefined;

  const openAdd = () => {
    setForm({ name: "", category: mergedCategories[0] || "", branchId: "", supplierId: "", stock: "", reorder: "5", costPrice: "", price: "", barcode: "" });
    setAddOpen(true);
  };

  const openEdit = (id: string) => {
    const p = products.find(x => x.id === id);
    if (!p) return;
    setForm({ name: p.name, category: p.category, branchId: p.branchId || "", supplierId: p.supplierId || "", stock: String(p.stock), reorder: String(p.reorder), costPrice: String(p.costPrice || ""), price: String(p.price), barcode: p.barcode || "" });
    setEditProduct(id);
  };

  const generateSku = (name: string, cat: string) => {
    const prefix = cat.substring(0, 3).toUpperCase();
    const suffix = String(products.length + 1).padStart(3, "0");
    return `${prefix}${suffix}`;
  };

  const handleSave = async () => {
    setSaving(true);
    const stock = parseInt(form.stock) || 0;
    const reorder = parseInt(form.reorder) || 5;
    const costPrice = parseFloat(form.costPrice) || 0;
    const price = parseFloat(form.price) || 0;

    const saveOffline = () => {
      if (editProduct) {
        updateProduct(editProduct, {
          name: form.name,
          category: form.category,
          branchId: undefined,
          branchName: "",
          stock,
          reorder,
          costPrice,
          price,
          barcode: form.barcode,
        });
        if (/^\d+$/.test(editProduct)) {
          addToOfflineQueue({
            type: "product_update",
            payload: {
              id: parseInt(editProduct, 10),
              name: form.name,
              categoryName: form.category,
              preferred_supplier: form.supplierId || undefined,
              stock,
              reorder_level: reorder,
              cost_price: costPrice,
              price,
              barcode: form.barcode,
            },
          });
        }
        setEditProduct(null);
        toast.success("Product update saved locally. It will sync when you are back online.");
      } else {
        const sku = generateSku(form.name, form.category);
        const localId = addProduct({
          name: form.name,
          sku,
          category: form.category,
          branchId: undefined,
          branchName: "",
          stock,
          reorder,
          costPrice,
          price,
          barcode: form.barcode,
        });
        addToOfflineQueue({
          type: "product_create",
          payload: {
            local_id: localId,
            name: form.name,
            sku,
            categoryName: form.category,
            preferred_supplier: form.supplierId || undefined,
            stock,
            reorder_level: reorder,
            cost_price: costPrice,
            price,
            barcode: form.barcode,
          },
        });
        setAddOpen(false);
        toast.success("Product saved locally. It will sync when you are back online.");
      }
    };

    if (!navigator.onLine && !canQueueOfflineAction()) {
      toast.error("Offline mode is available after you have signed in on this device.");
      setSaving(false);
      return;
    }

    if (canQueueOfflineAction()) {
      saveOffline();
      setSaving(false);
      return;
    }

    try {
      if (editProduct) {
        const saved = await updateProductApi(editProduct, {
          name: form.name,
          categoryName: form.category,
          preferred_supplier: form.supplierId || undefined,
          stock,
          reorder_level: reorder,
          cost_price: costPrice,
          price,
          barcode: form.barcode,
        });
        upsertProduct(mapProductResponse(saved));
        setEditProduct(null);
        toast.success("Product updated!");
      } else {
        const sku = generateSku(form.name, form.category);
        const created = await createProductApi({
          name: form.name,
          sku,
          categoryName: form.category,
          preferred_supplier: form.supplierId || undefined,
          stock,
          reorder_level: reorder,
          cost_price: costPrice,
          price,
          barcode: form.barcode,
        });
        upsertProduct(mapProductResponse(created));
        setAddOpen(false);
        addActivity({ text: `Added product: ${form.name}`, time: "Just now", type: "restock" });
        toast.success("Product added!");
      }
    } catch (e) {
      if (canQueueOfflineAction()) {
        saveOffline();
      } else {
        toast.error(e instanceof Error ? e.message : "Could not save product", {
          description: "Open Billing to review your limits and upgrade options.",
          action: { label: "Billing", onClick: () => navigate("/billing") },
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleBarcodeDetected = async (code: string) => {
    const found = products.find(p => p.barcode === code);
    if (found) {
      cacheBarcodeEntry({
        barcode: code,
        name: found.name,
        category: found.category,
        source: "inventory",
      });
      toast.info(`Found: ${found.name} (Stock: ${found.stock})`);
      setSearch(found.name);
      setScanOpen(false);
      return;
    }

    const cached = getCachedBarcodeEntry(code);
    if (cached) {
      setForm({
        name: cached.name,
        category: resolveCategoryForForm(cached.category),
        branchId: "",
        supplierId: "",
        stock: "",
        reorder: "5",
        costPrice: "",
        price: "",
        barcode: code,
      });
      setAddOpen(true);
      toast.success(`Loaded cached barcode match: ${cached.name}`);
      setScanOpen(false);
      return;
    }

    try {
      const identified = await identifyBarcodeProductApi(code);
      const identifiedName = [identified.brand, identified.name].filter(Boolean).join(" ");
      cacheBarcodeEntry({
        barcode: code,
        name: identifiedName || identified.name,
        brand: identified.brand,
        category: identified.category,
        source: identified.source,
      });
      setForm({
        name: identifiedName || identified.name || "",
        category: resolveCategoryForForm(identified.category),
        branchId: "",
        supplierId: "",
        stock: "",
        reorder: "5",
        costPrice: "",
        price: "",
        barcode: code,
      });
      setAddOpen(true);
      toast.success(identified.name ? `Identified: ${identified.name}` : `Barcode found: ${code}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not identify this barcode.";
      toast.info(`${message} Fill in the product details and save.`);
      setForm({ name: "", category: mergedCategories[0] || "", branchId: "", supplierId: "", stock: "", reorder: "5", costPrice: "", price: "", barcode: code });
      setAddOpen(true);
    }
    setScanOpen(false);
  };

  const formDialog = (
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="font-display">{editProduct ? "Edit Product" : "Add Product"}</DialogTitle>
        <DialogDescription>
          Save stock levels, reorder points, and base cost for this product.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div><Label>Product Name</Label><Input ref={productNameInputRef} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1" placeholder="e.g. White Bread Loaf" /></div>
        <div>
          <Label>Category</Label>
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            {mergedCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {/*
        Multiple branches are disabled for now. Keep this field for later reactivation.
        <div>
          <Label>Branch</Label>
          <select value={form.branchId} onChange={e => setForm({ ...form, branchId: e.target.value })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">No branch assigned</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        */}
        {/*
        Supplier assignment is hidden for now. Keep this field for later reactivation.
        <div>
          <Label>Preferred Supplier</Label>
          <select value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Not assigned</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        */}
        <div className="grid grid-cols-3 gap-2">
          <div><Label>Stock</Label><Input type="number" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} className="mt-1" /></div>
          <div><Label>Reorder At</Label><Input type="number" value={form.reorder} onChange={e => setForm({ ...form, reorder: e.target.value })} className="mt-1" /></div>
          <div>
            <Label>Cost ({sym})</Label>
            <Input type="number" value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} className="mt-1" />
            {editProduct ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {inventoryCostMetaText(selectedEditProduct?.costCurrency, selectedEditProduct?.costFxRateToBase)}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">Base cost</p>
            )}
          </div>
        </div>
        {/*
        Selling price is hidden for now. Keep this field for later reactivation.
        <div>
          <Label>Price ({sym})</Label><Input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="mt-1" />
          <p className="text-xs text-muted-foreground mt-1">Margin: {pricePreview(form.price, form.costPrice)}%</p>
        </div>
        */}
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
          {canUseCameraScan && (
            <Button
              variant="outline"
              onClick={() => {
                if (!canUse("barcode_scanning")) {
                  promptUpgrade("barcode_scanning", "Barcode scanning");
                  return;
                }
                setScanOpen(true);
              }}
            >
              <ScanBarcode className="h-4 w-4 mr-2" /> Scan
            </Button>
          )}
          <Button onClick={openAdd} className="bg-gradient-hero text-primary-foreground"><Plus className="h-4 w-4 mr-2" /> Add Product</Button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button key={c} onClick={() => setCategory(c)} className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${category === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>{c}</button>
        ))}
      </div>

      {flaggedView ? (
        <Card className="border-primary/20 bg-muted/40 shadow-soft dark:bg-muted/10">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Showing flagged inventory items</p>
              <p className="text-xs text-muted-foreground">This view includes low stock, out of stock, and high-value items from audit results.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchParams({});
              }}
            >
              Clear Filter
            </Button>
          </div>
        </Card>
      ) : null}

      {forecast.length > 0 && (
        <Card className="shadow-soft p-4 dark:border-border dark:bg-card">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-medium">Inventory Forecast</p>
              <p className="text-xs text-muted-foreground">Based on the last {forecastHorizon} days of sales activity</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {forecast.map((item) => {
              const meta = forecastRiskMeta(item.risk, forecastHorizon, item.days_remaining);
              return (
              <div key={item.product.id} className="rounded-lg border border-border bg-background/80 p-3 dark:bg-muted/10">
                <p className="text-sm font-medium truncate">{item.product.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.days_remaining == null ? "No recent sales yet, so days remaining cannot be projected." : `${item.days_remaining} days of stock left at the current sales pace`}
                </p>
                <p className="mt-2 text-xs">Sold in period: <span className="font-semibold">{item.sold_in_period}</span></p>
                <p className="mt-1 text-xs">Average per day: <span className="font-semibold">{item.average_daily_sales}</span></p>
                <p className="mt-1 text-xs">Suggested reorder: <span className="font-semibold">{item.suggested_reorder}</span></p>
                <p className="mt-2 text-[11px] text-muted-foreground">{meta.description}</p>
                <Badge className={`mt-2 ${meta.badgeClass}`}>{meta.label}</Badge>
              </div>
            )})}
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="No products found" description={search ? "Try a different search term" : "Add your first product to get started"} actionLabel="Add Product" onAction={openAdd} />
      ) : (
        <Card className="shadow-soft overflow-hidden dark:border-border dark:bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 font-medium text-muted-foreground">Product</th>
                  <th className="text-left p-3 font-medium text-muted-foreground hidden sm:table-cell">SKU</th>
                  <th className="text-left p-3 font-medium text-muted-foreground hidden md:table-cell">Category</th>
                  {/* Supplier visibility is disabled in the inventory table for now. */}
                  <th className="text-center p-3 font-medium text-muted-foreground">Stock</th>
                  <th className="text-right p-3 font-medium text-muted-foreground hidden lg:table-cell">Cost</th>
                  {/* Selling price is hidden in the inventory table for now. */}
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
                    {/* Supplier visibility is disabled in the inventory table for now. */}
                    <td className="p-3 text-center">{p.stock}</td>
                    <td className="p-3 text-right hidden lg:table-cell">
                      <div>
                        <p>{sym}{(p.costPrice || 0).toFixed(2)}</p>
                        {secondaryCurrency && secondaryRate ? (
                          <p className="text-[10px] text-muted-foreground">{formatSecondaryCost(p.costPrice || 0)}</p>
                        ) : null}
                      </div>
                    </td>
                    {/* Selling price is hidden in the inventory table for now. */}
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

      {/*
      {showAssistant && (
        <Card className="shadow-soft border-primary/20">
          <CardContent className="p-4 lg:p-5">
            <p className="text-sm font-medium text-muted-foreground mb-2">Auto Admin Assistant — next steps for your stock</p>
            <AdminAssistant autoExpand onDismissAutoExpand={() => setShowAssistant(false)} />
          </CardContent>
        </Card>
      )}
      */}

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
            if (canQueueOfflineAction()) {
              if (/^\d+$/.test(deleteId)) {
                addToOfflineQueue({ type: "product_delete", payload: { id: parseInt(deleteId, 10) } });
              }
            } else {
              await deleteProductApi(deleteId);
            }
            deleteProduct(deleteId);
            toast.success(canQueueOfflineAction() ? "Product removal saved locally. It will sync when you are back online." : "Product removed");
          } catch (e) {
            if (canQueueOfflineAction() && /^\d+$/.test(deleteId)) {
              addToOfflineQueue({ type: "product_delete", payload: { id: parseInt(deleteId, 10) } });
              deleteProduct(deleteId);
              toast.success("Product removal saved locally. It will sync when you are back online.");
            } else {
              toast.error(e instanceof Error ? e.message : "Delete failed");
            }
          }
          setDeleteId(null);
        }}
      />
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleBarcodeDetected} />
    </div>
  );
};

export default Inventory;
