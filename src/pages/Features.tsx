import { motion } from "framer-motion";
import { ArrowRight, BarChart3, Bell, CheckCircle2, ClipboardCheck, MessageSquare, Receipt, ScanBarcode, ShieldCheck, Users, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const features = [
  { icon: ScanBarcode, title: "Inventory that stays accurate", description: "Add products, scan barcodes, set reorder points, and see what is selling or running low before it becomes a problem.", points: ["Barcode lookups", "Low-stock alerts", "Stock movement history"] },
  { icon: Receipt, title: "Sales and expenses in one flow", description: "Record sales, issue receipts, manage tills, and capture business expenses without moving between separate tools.", points: ["Fast sale recording", "Receipt capture", "Till and payment tracking"] },
  { icon: ClipboardCheck, title: "Stock audits with accountability", description: "Compare counted stock with expected stock, investigate discrepancies, and keep a clear audit trail for your team.", points: ["Guided stock counts", "Discrepancy tracking", "Resolution history"] },
  { icon: Users, title: "Customers and loyal buyers", description: "Build a useful customer record with purchase activity, QR codes, loyalty points, credits, and repeat-visit history.", points: ["Customer profiles", "QR loyalty", "Store-credit tracking"] },
  { icon: WifiOff, title: "Work even when the network does not", description: "Keep recording essential work offline. When a connection returns, Verifin queues and syncs your changes.", points: ["Offline-ready workflows", "Queued changes", "Safe sync recovery"] },
  { icon: BarChart3, title: "Reports that point to next actions", description: "Use sales, stock, expense, and audit reports to understand the business day and make a confident next move.", points: ["Sales summaries", "Stock movement reports", "Actionable insights"] },
];

const workflow = [
  { icon: ScanBarcode, title: "Sell", text: "Record a sale and update stock." },
  { icon: Bell, title: "Notice", text: "Get alerted when stock needs attention." },
  { icon: MessageSquare, title: "Act", text: "Share reports and make the next decision." },
];

const Features = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <section className="relative overflow-hidden px-4 py-20 sm:py-28">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(152_55%_28%/0.1),transparent_58%)]" />
          <div className="container relative max-w-4xl text-center">
            <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary"><CheckCircle2 className="h-4 w-4" />Built for the work behind every sale</div>
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">One workspace for the<br /><span className="text-gradient-hero">business day in motion.</span></h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">Verifin connects the daily work of selling, stocking, spending, and checking performance—so you can spend less time chasing information.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><Button size="lg" className="bg-gradient-hero text-primary-foreground" onClick={() => navigate("/login?signup=1")}>Set up my workspace <ArrowRight className="ml-2 h-4 w-4" /></Button><Button size="lg" variant="outline" onClick={() => navigate("/demo")}>Explore live preview</Button></div>
          </div>
        </section>

        <section className="border-y border-border bg-muted/30 px-4 py-12">
          <div className="container grid gap-6 md:grid-cols-3">{workflow.map((item, index) => <div key={item.title} className="flex items-center gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><item.icon className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">0{index + 1}</p><h2 className="font-display font-semibold">{item.title}</h2><p className="text-sm text-muted-foreground">{item.text}</p></div></div>)}</div>
        </section>

        <section className="container px-4 py-20 sm:py-24">
          <div className="mb-12 max-w-2xl"><p className="text-sm font-semibold uppercase tracking-wider text-primary">Capabilities</p><h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">The tools your team uses every day.</h2><p className="mt-4 text-muted-foreground">Each feature is designed to work together, not create another place for data to get lost.</p></div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{features.map((feature, index) => <motion.article key={feature.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: index * 0.06 }} className="rounded-2xl border border-border bg-card p-6 shadow-soft"><div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><feature.icon className="h-6 w-6" /></div><h3 className="font-display text-lg font-semibold">{feature.title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.description}</p><ul className="mt-5 space-y-2">{feature.points.map((point) => <li key={point} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />{point}</li>)}</ul></motion.article>)}</div>
        </section>

        <section className="container px-4 pb-20 sm:pb-24"><div className="rounded-3xl bg-gradient-hero px-6 py-12 text-center text-primary-foreground sm:px-12"><ShieldCheck className="mx-auto mb-4 h-8 w-8" /><h2 className="font-display text-3xl font-bold">Start with the work that matters today.</h2><p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">Create your workspace, add your products, and start building a clearer picture of your business.</p><Button size="lg" className="mt-7 bg-card text-foreground hover:bg-card/90" onClick={() => navigate("/login?signup=1")}>Create a free account <ArrowRight className="ml-2 h-4 w-4" /></Button></div></section>
      </main>
      <Footer />
    </div>
  );
};

export default Features;
