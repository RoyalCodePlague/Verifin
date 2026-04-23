import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { createProductApi, ensureInventoryCategoryId, patchMe } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle,
  DollarSign,
  FileText,
  Layers3,
  Package,
  Plus,
  ReceiptText,
  Store,
  Truck,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getRegionalCurrencyDefaults } from "@/lib/currency";

const currencies = [
  { code: "ZAR", symbol: "R", label: "South African Rand" },
  { code: "USD", symbol: "$", label: "US Dollar" },
  { code: "ZWL", symbol: "ZWL", label: "Zimbabwean Dollar" },
  { code: "KES", symbol: "KSh", label: "Kenyan Shilling" },
  { code: "NGN", symbol: "N", label: "Nigerian Naira" },
  { code: "GHS", symbol: "GHs", label: "Ghanaian Cedi" },
];

type BusinessType = "retail" | "wholesale" | "hybrid";
type SetupGoal = "sales" | "stock" | "suppliers" | "invoices";

const businessTypes: Array<{
  id: BusinessType;
  title: string;
  description: string;
  icon: typeof Store;
  categories: string[];
  starterProducts: string[];
}> = [
  {
    id: "retail",
    title: "Retail Shop",
    description: "Best for stores that mainly sell directly to walk-in customers.",
    icon: Store,
    categories: ["Groceries", "Beverages", "Household", "Personal Care"],
    starterProducts: ["Bread", "Sugar", "Milk"],
  },
  {
    id: "wholesale",
    title: "Supplier / Wholesale",
    description: "Built for buying stock in bulk and supplying other shops or companies.",
    icon: Truck,
    categories: ["Bulk Goods", "Electronics", "Hardware", "Packaging"],
    starterProducts: ["Laptops", "Spoons", "Boxes"],
  },
  {
    id: "hybrid",
    title: "Mixed Business",
    description: "For businesses that both sell to customers and supply other businesses.",
    icon: Layers3,
    categories: ["Groceries", "Hardware", "Electronics", "Wholesale Items"],
    starterProducts: ["Cooking Oil", "Extension Cable", "Office Chairs"],
  },
];

const setupGoals: Array<{
  id: SetupGoal;
  title: string;
  description: string;
  icon: typeof ReceiptText;
}> = [
  { id: "sales", title: "Record Sales", description: "Track what is sold each day.", icon: ReceiptText },
  { id: "stock", title: "Track Inventory", description: "Know what is in stock and what is running low.", icon: Package },
  { id: "suppliers", title: "Manage Supply Movements", description: "Record stock in and stock out from suppliers and companies.", icon: Truck },
  { id: "invoices", title: "Invoice Better", description: "Use printable invoices and payment status tracking.", icon: FileText },
];

const steps = [
  { title: "Business", desc: "Name your business and choose your setup style." },
  { title: "Goals", desc: "Pick what you want Verifin to help with first." },
  { title: "Currency", desc: "Choose how you price and report your numbers." },
  { title: "Categories", desc: "Start with smart defaults and adjust them if needed." },
  { title: "Starter Stock", desc: "Add a few sample products so the app feels ready immediately." },
];

interface QuickProduct {
  name: string;
  price: string;
  stock: string;
  category: string;
}

function starterProductsFor(type: BusinessType, categories: string[]): QuickProduct[] {
  const business = businessTypes.find((item) => item.id === type) || businessTypes[0];
  const defaultCategory = categories[0] || business.categories[0] || "General";
  return business.starterProducts.map((name, index) => ({
    name,
    price: index === 0 ? "0" : "",
    stock: index === 0 ? "0" : "",
    category: categories[index] || defaultCategory,
  }));
}

const Onboarding = () => {
  const navigate = useNavigate();
  const { setProfile, profile } = useStore();
  const { refreshUser } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [bizName, setBizName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("retail");
  const [goals, setGoals] = useState<SetupGoal[]>(["sales", "stock"]);
  const [currency, setCurrency] = useState(() => getRegionalCurrencyDefaults().baseCurrency);
  const [categories, setCategories] = useState<string[]>(businessTypes[0].categories);
  const [newCategory, setNewCategory] = useState("");
  const [quickProducts, setQuickProducts] = useState<QuickProduct[]>(() => starterProductsFor("retail", businessTypes[0].categories));
  const [showSkipWarning, setShowSkipWarning] = useState(false);

  const currencyObj = currencies.find((item) => item.code === currency) || currencies[0];
  const businessMeta = useMemo(
    () => businessTypes.find((item) => item.id === businessType) || businessTypes[0],
    [businessType]
  );

  useEffect(() => {
    setCategories((current) => {
      if (current.length > 0 && current.some((item) => !businessMeta.categories.includes(item))) return current;
      return businessMeta.categories;
    });
  }, [businessMeta]);

  useEffect(() => {
    setQuickProducts((current) => {
      if (current.some((item) => item.name.trim() || item.price.trim() || item.stock.trim())) return current;
      return starterProductsFor(businessType, businessMeta.categories);
    });
  }, [businessMeta, businessType]);

  const toggleGoal = (goal: SetupGoal) => {
    setGoals((current) => current.includes(goal) ? current.filter((item) => item !== goal) : [...current, goal]);
  };

  const applyBusinessTemplate = () => {
    setCategories(businessMeta.categories);
    setQuickProducts(starterProductsFor(businessType, businessMeta.categories));
  };

  const next = async () => {
    if (step < steps.length - 1) setStep(step + 1);
    else await finish();
  };

  const back = () => step > 0 && setStep(step - 1);

  const finish = async () => {
    setSaving(true);
    try {
      await patchMe({
        business_name: bizName || "My Business",
        currency,
        currency_symbol: currencyObj.symbol,
        onboarding_complete: true,
      });

      for (const category of categories) {
        await ensureInventoryCategoryId(category);
      }

      for (let i = 0; i < quickProducts.length; i += 1) {
        const product = quickProducts[i];
        if (!product.name.trim()) continue;
        await createProductApi({
          name: product.name.trim(),
          sku: `PRD${String(i + 100).padStart(3, "0")}`,
          categoryName: product.category,
          stock: parseInt(product.stock, 10) || 0,
          reorder_level: 5,
          cost_price: 0,
          price: parseFloat(product.price) || 0,
        });
      }

      setProfile({
        ...profile,
        name: bizName || "My Business",
        currency,
        currencySymbol: currencyObj.symbol,
        categories,
        onboardingComplete: true,
      });
      await refreshUser();
      toast.success("Your workspace is ready");
      navigate("/dashboard");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save setup");
    } finally {
      setSaving(false);
    }
  };

  const confirmSkip = async () => {
    setShowSkipWarning(false);
    setSaving(true);
    try {
      await patchMe({ onboarding_complete: true });
      setProfile({ ...profile, onboardingComplete: true });
      await refreshUser();
      navigate("/dashboard");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  const canNext = () => {
    if (step === 0) return bizName.trim().length > 0;
    if (step === 1) return goals.length > 0;
    if (step === 2) return true;
    if (step === 3) return categories.length > 0;
    return true;
  };

  const addCategory = () => {
    const trimmed = newCategory.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    setCategories((current) => [...current, trimmed]);
    setNewCategory("");
  };

  const removeCategory = (value: string) => {
    setCategories((current) => current.filter((item) => item !== value));
  };

  const addQuickProduct = () => {
    setQuickProducts((current) => [...current, {
      name: "",
      price: "",
      stock: "",
      category: categories[0] || "General",
    }]);
  };

  const updateQuickProduct = (index: number, field: keyof QuickProduct, value: string) => {
    setQuickProducts((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };

  const onboardingHighlights = [
    `${businessMeta.title} setup template`,
    `${goals.length} workflow${goals.length === 1 ? "" : "s"} selected`,
    `${categories.length} starter categor${categories.length === 1 ? "y" : "ies"}`,
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.08),_transparent_32%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/0.35))] px-4 py-6 lg:px-8 lg:py-10">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_420px]">
        <div className="rounded-[2rem] border border-border/70 bg-card/90 p-6 shadow-soft backdrop-blur lg:p-8">
          <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5 text-primary" />
                Setup designed for how you actually work
              </div>
              <h1 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">Set up Verifin around your business, not the other way round.</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Choose your business style, the workflows you care about most, and a starter setup that already feels close to finished.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Step {step + 1} of {steps.length}</p>
              <p className="mt-2 font-medium">{steps[step].title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{steps[step].desc}</p>
            </div>
          </div>

          <div className="mb-8 grid grid-cols-5 gap-2">
            {steps.map((item, index) => (
              <div key={item.title} className={`h-2 rounded-full transition-colors ${index <= step ? "bg-primary" : "bg-muted"}`} />
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.22 }}
            >
              {step === 0 ? (
                <div className="space-y-6">
                  <div>
                    <Label>Business Name</Label>
                    <Input value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="e.g. Moyo Wholesale Traders" className="mt-2 h-12" autoFocus />
                  </div>

                  <div>
                    <p className="text-sm font-medium">What kind of setup fits you best?</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {businessTypes.map((item) => {
                        const Icon = item.icon;
                        const active = item.id === businessType;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setBusinessType(item.id)}
                            className={`rounded-2xl border p-4 text-left transition-all ${active ? "border-primary bg-primary/8 shadow-soft" : "border-border bg-background hover:border-primary/40 hover:bg-muted/50"}`}
                          >
                            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <p className="mt-4 font-display text-lg font-semibold">{item.title}</p>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}

              {step === 1 ? (
                <div className="space-y-6">
                  <div className="grid gap-3 md:grid-cols-2">
                    {setupGoals.map((goal) => {
                      const Icon = goal.icon;
                      const active = goals.includes(goal.id);
                      return (
                        <button
                          key={goal.id}
                          type="button"
                          onClick={() => toggleGoal(goal.id)}
                          className={`rounded-2xl border p-4 text-left transition-all ${active ? "border-primary bg-primary/8 shadow-soft" : "border-border bg-background hover:border-primary/40 hover:bg-muted/50"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                              <Icon className="h-4.5 w-4.5" />
                            </div>
                            {active ? <CheckCircle className="h-5 w-5 text-primary" /> : null}
                          </div>
                          <p className="mt-4 font-medium">{goal.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{goal.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {step === 2 ? (
                <div className="space-y-6">
                  <div className="grid gap-3 md:grid-cols-2">
                    {currencies.map((item) => (
                      <button
                        key={item.code}
                        type="button"
                        onClick={() => setCurrency(item.code)}
                        className={`rounded-2xl border p-4 text-left transition-all ${currency === item.code ? "border-primary bg-primary/8 shadow-soft" : "border-border bg-background hover:border-primary/40 hover:bg-muted/50"}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl font-display text-lg font-bold ${currency === item.code ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                            {item.symbol}
                          </div>
                          <div>
                            <p className="font-medium">{item.label}</p>
                            <p className="text-xs text-muted-foreground">{item.code}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {step === 3 ? (
                <div className="space-y-5">
                  <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">Use {businessMeta.title} starter categories</p>
                      <p className="text-sm text-muted-foreground">These defaults match the business style you selected, and you can still customize them.</p>
                    </div>
                    <Button variant="outline" onClick={applyBusinessTemplate}>Apply Template</Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {categories.map((category) => (
                      <span key={category} className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
                        {category}
                        <button type="button" onClick={() => removeCategory(category)} className="hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Add another category..." onKeyDown={(e) => e.key === "Enter" && addCategory()} />
                    <Button variant="outline" onClick={addCategory}><Plus className="h-4 w-4" /></Button>
                  </div>
                </div>
              ) : null}

              {step === 4 ? (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">Starter stock for {businessMeta.title}</p>
                      <p className="text-sm text-muted-foreground">Use suggested examples, edit them, or remove them. You can also skip this and add stock later.</p>
                    </div>
                    <Button variant="outline" onClick={applyBusinessTemplate}>Reset Suggestions</Button>
                  </div>

                  {quickProducts.map((product, index) => (
                    <div key={`${product.name}-${index}`} className="grid gap-2 rounded-2xl border border-border bg-background p-4 sm:grid-cols-2">
                      <Input placeholder="Product name" value={product.name} onChange={(e) => updateQuickProduct(index, "name", e.target.value)} className="sm:col-span-2" />
                      <Input placeholder="Selling price" type="number" value={product.price} onChange={(e) => updateQuickProduct(index, "price", e.target.value)} />
                      <Input placeholder="Opening stock" type="number" value={product.stock} onChange={(e) => updateQuickProduct(index, "stock", e.target.value)} />
                      <select value={product.category} onChange={(e) => updateQuickProduct(index, "category", e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm sm:col-span-2">
                        {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                    </div>
                  ))}

                  <Button variant="outline" onClick={addQuickProduct} className="w-full">
                    <Plus className="mr-2 h-4 w-4" /> Add Another Product
                  </Button>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>

          <div className="mt-8 flex items-center justify-between">
            <Button variant="ghost" onClick={back} disabled={step === 0}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <Button onClick={next} disabled={!canNext() || saving} className="bg-gradient-hero text-primary-foreground">
              {step === steps.length - 1 ? (
                <><Check className="mr-2 h-4 w-4" /> {saving ? "Saving..." : "Launch Workspace"}</>
              ) : (
                <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
            </Button>
          </div>

          <button onClick={() => setShowSkipWarning(true)} className="mt-4 w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground">
            Skip for now
          </button>
        </div>

        <div className="space-y-4">
          <Card className="overflow-hidden border-border/70 bg-card/90 shadow-soft backdrop-blur">
            <CardContent className="p-0">
              <div className="bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--primary)))] p-6 text-primary-foreground">
                <p className="text-xs uppercase tracking-[0.22em] text-primary-foreground/70">Workspace Preview</p>
                <h2 className="mt-3 font-display text-2xl font-bold">{bizName || "Your Business"}</h2>
                <p className="mt-2 text-sm text-primary-foreground/80">{businessMeta.description}</p>
              </div>
              <div className="space-y-5 p-6">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <BriefcaseBusiness className="h-4 w-4" />
                      <span className="text-xs uppercase tracking-[0.18em]">Business Type</span>
                    </div>
                    <p className="mt-3 font-medium">{businessMeta.title}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <DollarSign className="h-4 w-4" />
                      <span className="text-xs uppercase tracking-[0.18em]">Currency</span>
                    </div>
                    <p className="mt-3 font-medium">{currencyObj.label}</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">What this setup enables first</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {goals.map((goalId) => {
                      const goal = setupGoals.find((item) => item.id === goalId);
                      if (!goal) return null;
                      return (
                        <span key={goalId} className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
                          <goal.icon className="h-3.5 w-3.5" />
                          {goal.title}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Snapshot</p>
                  <div className="mt-3 space-y-2">
                    {onboardingHighlights.map((item) => (
                      <div key={item} className="flex items-center gap-2 rounded-xl bg-muted/30 px-3 py-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-primary" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/90 shadow-soft backdrop-blur">
            <CardContent className="p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Starter categories</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {categories.slice(0, 8).map((category) => (
                  <span key={category} className="rounded-full border border-border px-3 py-1.5 text-sm">{category}</span>
                ))}
              </div>
              <p className="mt-5 text-xs uppercase tracking-[0.18em] text-muted-foreground">Starter products</p>
              <div className="mt-3 space-y-2">
                {quickProducts.slice(0, 3).map((product, index) => (
                  <div key={`${product.name}-${index}`} className="flex items-center justify-between rounded-xl bg-muted/30 px-3 py-2 text-sm">
                    <span>{product.name || "Untitled product"}</span>
                    <span className="text-muted-foreground">{product.category}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showSkipWarning} onOpenChange={setShowSkipWarning}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Building2 className="h-5 w-5 text-warning" /> Finish later?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You can skip onboarding, but your dashboard, categories, and starter products will feel much more complete if you finish this now.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={() => setShowSkipWarning(false)} className="flex-1">Keep Setting Up</Button>
            <Button onClick={confirmSkip} className="flex-1 bg-gradient-hero text-primary-foreground">Skip Anyway</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Onboarding;
