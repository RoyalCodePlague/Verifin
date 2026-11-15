import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronLeft, ShoppingCart, Package, Receipt, ClipboardCheck, BarChart3, Sparkles, Check, QrCode, LayoutDashboard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import { getDetectedPricingCountry } from "@/lib/api";
import { formatRegionalSampleAmount } from "@/lib/pricing";

const countryCode = getDetectedPricingCountry();

const tourSteps = [
  {
    title: "Record Sales Instantly",
    desc: "Select a product, enter the quantity, and record the sale. Stock and sales totals update together.",
    icon: ShoppingCart,
    action: "sale",
  },
  {
    title: "Track Your Inventory",
    desc: "See stock levels at a glance. Low stock items are highlighted in amber, out-of-stock in red. Click items to see details.",
    icon: Package,
    action: "inventory",
  },
  {
    title: "Log Expenses Easily",
    desc: "Enter an expense description and amount to track your business spending.",
    icon: Receipt,
    action: "expense",
  },
  {
    title: "Run Stock Audits",
    desc: "Compare expected vs actual stock. Verifin detects discrepancies automatically and alerts you instantly.",
    icon: ClipboardCheck,
    action: "audit",
  },
  {
    title: "QR Customer Loyalty",
    desc: "Give customers QR codes that track visits, spending, and loyalty points. Reward them with credits and discounts!",
    icon: QrCode,
    action: "qr",
  },
  {
    title: "Business Insights",
    desc: "Get actionable business intelligence like low stock warnings, sales trend analysis, and restocking suggestions.",
    icon: Sparkles,
    action: "insights",
  },
  {
    title: "See your day at a glance",
    desc: "Review example sales, stock, and expense summaries from a sample workspace.",
    icon: LayoutDashboard,
    action: "dashboard",
  },
  {
    title: "Export Reports",
    desc: "Generate daily summaries, stock movement reports, profit analysis, and customer reports with one click.",
    icon: BarChart3,
    action: "reports",
  },
];

function SaleDemo() {
  const [quantity, setQuantity] = useState("3");
  const [recorded, setRecorded] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm">White Bread ? {formatRegionalSampleAmount(18, countryCode)} each</p>
      <label className="block text-sm">Quantity
        <Input type="number" min="1" step="1" value={quantity} onChange={e => { setQuantity(e.target.value); setRecorded(false); }} />
      </label>
      <Button disabled={recorded || !Number.isInteger(Number(quantity)) || Number(quantity) < 1} onClick={() => setRecorded(true)}>Record sample sale</Button>
      {recorded && <p className="text-sm text-success">Sample sale recorded: {quantity} loaves. Total: {formatRegionalSampleAmount(Number(quantity) * 18, countryCode)}.</p>}
    </div>
  );
}

function ExpenseDemo() {
  const [description, setDescription] = useState("Transport");
  const [amount, setAmount] = useState("200");
  const [recorded, setRecorded] = useState(false);
  return (
    <div className="space-y-3">
      <label className="block text-sm">Description<Input value={description} onChange={e => { setDescription(e.target.value); setRecorded(false); }} /></label>
      <label className="block text-sm">Amount<Input type="number" min="0.01" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setRecorded(false); }} /></label>
      <Button disabled={recorded || !description.trim() || !(Number(amount) > 0)} onClick={() => setRecorded(true)}>Record sample expense</Button>
      {recorded && <p className="text-sm text-success">Sample expense recorded for {description}.</p>}
    </div>
  );
}

function InventoryDemo() {
  const [selected, setSelected] = useState<string | null>(null);
  const items = [
    { name: "White Bread", stock: 24, status: "ok", price: formatRegionalSampleAmount(18, countryCode) },
    { name: "Cooking Oil 2L", stock: 3, status: "low", price: formatRegionalSampleAmount(65, countryCode) },
    { name: "Washing Powder", stock: 0, status: "out", price: formatRegionalSampleAmount(42, countryCode) },
  ];
  return (
    <div className="space-y-2">
      {items.map(it => (
        <motion.div key={it.name} whileHover={{ scale: 1.01 }} onClick={() => setSelected(selected === it.name ? null : it.name)} className="cursor-pointer">
          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
            <span className="text-sm font-medium">{it.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{it.price}</span>
              <span className="text-sm font-display font-bold">{it.stock}</span>
              <Badge className={
                it.status === "ok" ? "bg-success/10 text-success hover:bg-success/10"
                  : it.status === "low" ? "bg-warning/10 text-warning hover:bg-warning/10"
                  : "bg-destructive/10 text-destructive hover:bg-destructive/10"
              }>
                {it.status === "ok" ? "In Stock" : it.status === "low" ? "Low" : "Out"}
              </Badge>
            </div>
          </div>
          {selected === it.name && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="p-3 bg-primary/5 rounded-b-lg text-xs text-muted-foreground">
              Reorder level: 10 · Last restocked: 2 days ago · Weekly avg: 15 units
            </motion.div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

function QRDemo() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
        <div className="h-16 w-16 rounded-lg bg-card border border-border flex items-center justify-center">
          <QrCode className="h-8 w-8 text-primary" />
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm">Mama Ndlovu</p>
          <p className="text-xs text-muted-foreground">45 visits · 87 loyalty points</p>
          <Badge className="mt-1 bg-accent/10 text-accent hover:bg-accent/10">{formatRegionalSampleAmount(20, countryCode)} credit available</Badge>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded-lg bg-success/10"><p className="font-display font-bold text-success text-sm">{formatRegionalSampleAmount(8720, countryCode)}</p><p className="text-xs text-muted-foreground">Spent</p></div>
        <div className="p-2 rounded-lg bg-primary/10"><p className="font-display font-bold text-primary text-sm">45</p><p className="text-xs text-muted-foreground">Visits</p></div>
        <div className="p-2 rounded-lg bg-accent/10"><p className="font-display font-bold text-accent text-sm">{formatRegionalSampleAmount(20, countryCode)}</p><p className="text-xs text-muted-foreground">Credits</p></div>
      </div>
    </div>
  );
}

function InsightsDemo() {
  return (
    <div className="space-y-2">
      {[
        { text: "Sales dropped 15% vs last week", delay: 0 },
        { text: "Bread is your top seller (38 units)", delay: 0.2 },
        { text: "3 products need restocking", delay: 0.4 },
        { text: "Mama Ndlovu qualifies for a loyalty reward!", delay: 0.6 },
      ].map((ins, i) => (
        <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: ins.delay }} className="p-3 bg-muted/30 rounded-lg text-sm hover:bg-muted/50 transition-colors cursor-default">
          {ins.text}
        </motion.div>
      ))}
    </div>
  );
}

function DashboardDemo() {
  return (
    <div className="space-y-4" aria-label="Illustrative sample dashboard">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Sales today", formatRegionalSampleAmount(2486, countryCode)],
          ["Transactions", "38"],
          ["Products", "128"],
          ["Low stock", "3 items"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 font-display text-base font-bold sm:text-lg">{value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Sales this week</h3>
          <span className="text-xs text-muted-foreground">Sample totals</span>
        </div>
        <div className="flex h-28 items-end gap-2" aria-label="Sample weekly sales chart">
          {[42, 65, 50, 82, 60, 95, 72].map((height, index) => (
            <div key={index} className="flex h-full flex-1 items-end rounded-t bg-primary/10">
              <div className="w-full rounded-t bg-primary" style={{ height: `${height}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
      </div>
    </div>
  );
}

function ReportsDemo() {
  const rows = [
    ["Today", "38", formatRegionalSampleAmount(2486, countryCode)],
    ["Yesterday", "31", formatRegionalSampleAmount(1994, countryCode)],
    ["This week", "214", formatRegionalSampleAmount(12430, countryCode)],
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border p-4">
        <h3 className="font-semibold">Sales summary</h3>
        <p className="mt-1 text-xs text-muted-foreground">Illustrative sample figures</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="p-3 font-medium">Period</th><th className="p-3 font-medium">Transactions</th><th className="p-3 font-medium">Sales total</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row[0]} className="border-t border-border"><td className="p-3 font-medium">{row[0]}</td><td className="p-3">{row[1]}</td><td className="p-3">{row[2]}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="p-4 text-xs text-muted-foreground">Choose a date range and export reports in the workspace.</div>
    </div>
  );
}

const demoComponents: Record<string, React.FC> = {
  sale: SaleDemo,
  inventory: InventoryDemo,
  expense: ExpenseDemo,
  audit: InventoryDemo,
  qr: QRDemo,
  insights: InsightsDemo,
  dashboard: DashboardDemo,
  reports: ReportsDemo,
};

const Demo = () => {
  const [currentStep, setCurrentStep] = useState(() => {
    const requestedStep = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("step");
    const index = tourSteps.findIndex((tourStep) => tourStep.action === requestedStep);
    return index >= 0 ? index : 0;
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("step", tourSteps[currentStep].action);
    window.history.replaceState({}, "", url);
  }, [currentStep]);
  const step = tourSteps[currentStep];
  const DemoComp = demoComponents[step.action];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="py-16 px-4">
        <div className="container max-w-4xl">
          <div className="text-center mb-10">
            <h1 className="font-display font-bold text-3xl mb-2">
              <span className="text-gradient-hero">Interactive</span> Product Tour
            </h1>
            <p className="text-muted-foreground">Explore sales, stock, expenses, the dashboard and reports in {tourSteps.length} steps.</p>
            <p className="mx-auto mt-3 max-w-2xl text-xs text-muted-foreground">This walkthrough uses illustrative sample data. It is not connected to a business account.</p>
          </div>

          <div className="flex gap-2 mb-8 justify-center">
            {tourSteps.map((_, i) => (
              <button
                key={i}
                aria-label={`Show ${tourSteps[i].title}`}
                aria-pressed={i === currentStep}
                onClick={() => setCurrentStep(i)}
                className={`h-2 rounded-full transition-all ${i === currentStep ? "w-8 bg-primary" : i < currentStep ? "w-3 bg-primary/40" : "w-2 bg-muted hover:bg-muted-foreground/30"}`}
              />
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              <Card className="shadow-elevated" data-product-demo-card>
                <CardContent className="p-6 sm:p-8">
                  <div className="flex items-center gap-3 mb-2">
                    <motion.div 
                      initial={{ scale: 0.8, rotate: -10 }} 
                      animate={{ scale: 1, rotate: 0 }} 
                      transition={{ type: "spring", stiffness: 200 }}
                      className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"
                    >
                      <step.icon className="h-5 w-5 text-primary" />
                    </motion.div>
                    <div>
                      <Badge variant="secondary" className="text-xs mb-1">Step {currentStep + 1} of {tourSteps.length}</Badge>
                      <h2 className="font-display font-semibold text-lg">{step.title}</h2>
                    </div>
                  </div>

                  <div className="bg-muted/50 rounded-lg p-4 my-4">
                    <p className="text-sm text-muted-foreground">{step.desc}</p>
                  </div>

                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    transition={{ delay: 0.2 }}
                    className="mt-4"
                  >
                    <DemoComp />
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </AnimatePresence>

          <div className="flex justify-between mt-6">
            <Button variant="ghost" onClick={() => setCurrentStep(Math.max(0, currentStep - 1))} disabled={currentStep === 0}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            {currentStep < tourSteps.length - 1 ? (
              <Button onClick={() => setCurrentStep(currentStep + 1)} className="bg-gradient-hero text-primary-foreground">
                Next Step <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={() => window.location.href = "/login?signup=1"} className="bg-gradient-hero text-primary-foreground">
                Start Using Verifin <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Demo;
