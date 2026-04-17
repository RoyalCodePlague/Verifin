import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { createProductApi, ensureInventoryCategoryId, patchMe } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, DollarSign, Tags, Package, ArrowRight, ArrowLeft, Check, Plus, X, CheckCircle, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const currencies = [
  { code: "ZAR", symbol: "R", label: "South African Rand (R)" },
  { code: "USD", symbol: "$", label: "US Dollar ($)" },
  { code: "ZWL", symbol: "ZWL", label: "Zimbabwean Dollar (ZWL)" },
  { code: "KES", symbol: "KSh", label: "Kenyan Shilling (KSh)" },
  { code: "NGN", symbol: "₦", label: "Nigerian Naira (₦)" },
  { code: "GHS", symbol: "GH₵", label: "Ghanaian Cedi (GH₵)" },
];

const defaultCategories = ["Groceries", "Beverages", "Hardware", "Personal Care", "Electronics", "Clothing"];

const steps = [
  { icon: Building2, title: "Business Profile", desc: "What's your business called?" },
  { icon: DollarSign, title: "Currency", desc: "Which currency do you use?" },
  { icon: Tags, title: "Product Categories", desc: "Set up your stock categories" },
  { icon: Package, title: "Initial Stock", desc: "Add a few products to get started" },
];

interface QuickProduct {
  name: string;
  price: string;
  stock: string;
  category: string;
}

const Onboarding = () => {
  const navigate = useNavigate();
  const { setProfile, profile } = useStore();
  const { refreshUser } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [bizName, setBizName] = useState("");
  const [currency, setCurrency] = useState("ZAR");
  const [categories, setCategories] = useState<string[]>(["Groceries", "Beverages", "Hardware", "Personal Care"]);
  const [newCategory, setNewCategory] = useState("");
  const [quickProducts, setQuickProducts] = useState<QuickProduct[]>([
    { name: "", price: "", stock: "", category: "Groceries" },
  ]);
  const [showSkipWarning, setShowSkipWarning] = useState(false);

  const currencyObj = currencies.find(c => c.code === currency) || currencies[0];

  const next = async () => {
    if (step < 3) setStep(step + 1);
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
      for (const c of categories) {
        await ensureInventoryCategoryId(c);
      }
      for (let i = 0; i < quickProducts.length; i++) {
        const p = quickProducts[i];
        if (!p.name.trim()) continue;
        await createProductApi({
          name: p.name.trim(),
          sku: `PRD${String(i + 100).padStart(3, "0")}`,
          categoryName: p.category,
          stock: parseInt(p.stock) || 0,
          reorder_level: 5,
          price: parseFloat(p.price) || 0,
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
      toast.success("You're all set!");
      navigate("/dashboard");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save setup");
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    setShowSkipWarning(true);
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
    if (step === 1) return true;
    if (step === 2) return categories.length > 0;
    return true;
  };

  const addCat = () => {
    if (newCategory.trim() && !categories.includes(newCategory.trim())) {
      setCategories([...categories, newCategory.trim()]);
      setNewCategory("");
    }
  };

  const removeCat = (c: string) => setCategories(categories.filter(cat => cat !== c));

  const addQuickProduct = () => setQuickProducts([...quickProducts, { name: "", price: "", stock: "", category: categories[0] || "General" }]);

  const updateQuickProduct = (i: number, field: keyof QuickProduct, value: string) => {
    const updated = [...quickProducts];
    updated[i] = { ...updated[i], [field]: value };
    setQuickProducts(updated);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-gradient-hero flex items-center justify-center text-primary-foreground mx-auto mb-4">
            <CheckCircle className="h-7 w-7" />
          </div>
          <h1 className="font-display font-bold text-2xl">Welcome to Verifin</h1>
          <p className="text-sm text-muted-foreground mt-1">Let's set up your business in under 2 minutes</p>
        </div>

        <div className="flex gap-2 mb-6">
          {steps.map((s, i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="shadow-elevated">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  {(() => { const Icon = steps[step].icon; return <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><Icon className="h-5 w-5 text-primary" /></div>; })()}
                  <div>
                    <h2 className="font-display font-semibold">{steps[step].title}</h2>
                    <p className="text-xs text-muted-foreground">{steps[step].desc}</p>
                  </div>
                </div>

                {step === 0 && (
                  <div className="space-y-4">
                    <div>
                      <Label>Business Name</Label>
                      <Input value={bizName} onChange={e => setBizName(e.target.value)} placeholder="e.g. Thabo's General Store" className="mt-1.5" autoFocus />
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-2">
                    {currencies.map(c => (
                      <button
                        key={c.code}
                        onClick={() => setCurrency(c.code)}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg text-sm font-medium transition-colors text-left ${
                          currency === c.code ? "bg-primary/10 text-primary ring-1 ring-primary/30" : "bg-muted/50 hover:bg-muted"
                        }`}
                      >
                        <span className="font-display font-bold text-lg w-10">{c.symbol}</span>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {categories.map(c => (
                        <span key={c} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
                          {c}
                          <button onClick={() => removeCat(c)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="Add a category..." onKeyDown={e => e.key === "Enter" && addCat()} />
                      <Button variant="outline" onClick={addCat}><Plus className="h-4 w-4" /></Button>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Suggestions:</p>
                      <div className="flex flex-wrap gap-1">
                        {defaultCategories.filter(c => !categories.includes(c)).map(c => (
                          <button key={c} onClick={() => setCategories([...categories, c])} className="px-2.5 py-1 rounded-full bg-muted text-xs text-muted-foreground hover:bg-muted/80">
                            + {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-4">
                    {quickProducts.map((p, i) => (
                      <div key={i} className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-muted/30">
                        <Input placeholder="Product name" value={p.name} onChange={e => updateQuickProduct(i, "name", e.target.value)} className="col-span-2" />
                        <Input placeholder="Price" type="number" value={p.price} onChange={e => updateQuickProduct(i, "price", e.target.value)} />
                        <Input placeholder="Stock qty" type="number" value={p.stock} onChange={e => updateQuickProduct(i, "stock", e.target.value)} />
                        <select value={p.category} onChange={e => updateQuickProduct(i, "category", e.target.value)} className="col-span-2 h-10 rounded-md border border-input bg-background px-3 text-sm">
                          {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    ))}
                    <Button variant="outline" onClick={addQuickProduct} className="w-full">
                      <Plus className="h-4 w-4 mr-2" /> Add Another Product
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">You can skip this and add products later</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </AnimatePresence>

        <div className="flex justify-between mt-6">
          <Button variant="ghost" onClick={back} disabled={step === 0}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <Button onClick={next} disabled={!canNext() || saving} className="bg-gradient-hero text-primary-foreground">
            {step === 3 ? (
              <><Check className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Finish Setup"}</>
            ) : (
              <>Next <ArrowRight className="h-4 w-4 ml-2" /></>
            )}
          </Button>
        </div>

        <button onClick={handleSkip} className="w-full text-center text-xs text-muted-foreground mt-4 hover:text-foreground">
          Skip for now →
        </button>
      </div>

      {/* Skip Warning Dialog */}
      <Dialog open={showSkipWarning} onOpenChange={setShowSkipWarning}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-warning" /> Incomplete Profile
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your business profile isn't fully set up yet. You can complete it later in Settings, but some features may not work optimally without it.
          </p>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" onClick={() => setShowSkipWarning(false)} className="flex-1">Go Back</Button>
            <Button onClick={confirmSkip} className="flex-1 bg-gradient-hero text-primary-foreground">Skip Anyway</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Onboarding;
