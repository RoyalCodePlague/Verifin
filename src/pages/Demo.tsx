import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronLeft, ShoppingCart, Package, Receipt, ClipboardCheck, BarChart3, Sparkles, Check, QrCode } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const tourSteps = [
  {
    title: "Record Sales Instantly",
    desc: 'Type natural commands like "Sold 3 bread for R54" and the AI assistant records it automatically. Try it below!',
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
    desc: 'Type "Spent R200 on transport" and it\'s logged. No forms, no hassle. Try recording an expense below.',
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
    title: "AI-Powered Insights",
    desc: "Get actionable business intelligence like low stock warnings, sales trend analysis, and restocking suggestions.",
    icon: Sparkles,
    action: "insights",
  },
  {
    title: "Export Reports",
    desc: "Generate daily summaries, stock movement reports, profit analysis, and customer reports with one click.",
    icon: BarChart3,
    action: "reports",
  },
];

function SaleDemo() {
  const [input, setInput] = useState("");
  const [recorded, setRecorded] = useState(false);

  const handleRecord = () => {
    if (!input.trim()) { setInput("Sold 3 bread for R54"); return; }
    setRecorded(true);
    toast.success("Sale recorded!", { description: input });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
          <Input value={input} onChange={e => { setInput(e.target.value); setRecorded(false); }} placeholder='Try: "Sold 3 bread for R54"' className="pl-9" />
        </div>
        <Button onClick={handleRecord} className="bg-gradient-hero text-primary-foreground" disabled={recorded}>
          {recorded ? <Check className="h-4 w-4" /> : "Record"}
        </Button>
      </div>
      {recorded && (
        <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="bg-success/10 text-success rounded-lg p-3 text-sm flex items-center gap-2">
          <Check className="h-4 w-4 flex-shrink-0" /> Recorded! Inventory updated, daily total adjusted.
        </motion.div>
      )}
      <div className="flex gap-2 flex-wrap">
        {["Sold 5 milk for R110", "Sold 2 cement for R340"].map(s => (
          <button key={s} onClick={() => { setInput(s); setRecorded(false); }} className="px-3 py-1.5 rounded-full bg-muted text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">{s}</button>
        ))}
      </div>
    </div>
  );
}

function InventoryDemo() {
  const [selected, setSelected] = useState<string | null>(null);
  const items = [
    { name: "White Bread", stock: 24, status: "ok", price: "R18" },
    { name: "Cooking Oil 2L", stock: 3, status: "low", price: "R65" },
    { name: "Washing Powder", stock: 0, status: "out", price: "R42" },
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
          <Badge className="mt-1 bg-accent/10 text-accent hover:bg-accent/10">R20 credit available</Badge>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded-lg bg-success/10"><p className="font-display font-bold text-success text-sm">R8,720</p><p className="text-xs text-muted-foreground">Spent</p></div>
        <div className="p-2 rounded-lg bg-primary/10"><p className="font-display font-bold text-primary text-sm">45</p><p className="text-xs text-muted-foreground">Visits</p></div>
        <div className="p-2 rounded-lg bg-accent/10"><p className="font-display font-bold text-accent text-sm">R20</p><p className="text-xs text-muted-foreground">Credits</p></div>
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

const demoComponents: Record<string, React.FC> = {
  sale: SaleDemo,
  inventory: InventoryDemo,
  expense: SaleDemo,
  audit: InventoryDemo,
  qr: QRDemo,
  insights: InsightsDemo,
  reports: InsightsDemo,
};

const Demo = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const step = tourSteps[currentStep];
  const DemoComp = demoComponents[step.action];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="py-16 px-4">
        <div className="container max-w-3xl">
          <div className="text-center mb-10">
            <h1 className="font-display font-bold text-3xl mb-2">
              <span className="text-gradient-hero">Interactive</span> Product Tour
            </h1>
            <p className="text-muted-foreground">See how Verifin works in {tourSteps.length} simple steps</p>
          </div>

          <div className="flex gap-2 mb-8 justify-center">
            {tourSteps.map((_, i) => (
              <button
                key={i}
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
              <Card className="shadow-elevated">
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
