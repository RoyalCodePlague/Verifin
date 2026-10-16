import { motion } from "framer-motion";
import { Package, ShoppingCart, WifiOff, BarChart3, Receipt } from "lucide-react";

const features = [
  { icon: Package, title: "Know what is in stock", description: "Track product quantities, spot what is running low, and see how sales change your stock." },
  { icon: ShoppingCart, title: "Record daily sales", description: "Record what you sold and keep sale details together with your stock records." },
  { icon: Receipt, title: "Track business expenses", description: "Log business spending as it happens and review it alongside sales in your reports." },
  { icon: WifiOff, title: "Keep working when data drops", description: "Save supported sales, stock updates and expenses on this device. They queue for sync when your connection returns." },
  { icon: BarChart3, title: "See how the shop is doing", description: "Use clear sales, stock and expense summaries to understand what needs your attention." },
];

const FeaturesSection = () => (
  <section className="bg-muted/50 py-20" id="features">
    <div className="container">
      <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-14 text-center">
        <h2 className="mb-4 font-display text-3xl font-bold md:text-4xl">The four things you need to know, <span className="text-gradient-hero">in one place</span></h2>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">Keep track of stock, daily sales, expenses and how your shop is doing, even when the connection drops.</p>
      </motion.div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, index) => (
          <motion.article key={feature.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: index * 0.08 }} className="group rounded-xl bg-card p-6 shadow-card transition-all hover:-translate-y-1 hover:shadow-elevated">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><feature.icon className="h-5 w-5" /></div>
            <h3 className="mb-2 font-display text-lg font-semibold">{feature.title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
          </motion.article>
        ))}
      </div>
    </div>
  </section>
);

export default FeaturesSection;
