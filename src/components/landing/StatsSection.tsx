import { motion } from "framer-motion";

const stats = [
  { value: "Offline", label: "Keep working anywhere" },
  { value: "Live", label: "Stock updates as you sell" },
  { value: "1 place", label: "Sales, stock and expenses" },
  { value: "Ready", label: "For your team and devices" },
];

const StatsSection = () => (
  <section className="border-y border-border bg-muted/30 py-12">
    <div className="container">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="text-center">
            <p className="font-display text-3xl md:text-4xl font-bold text-gradient-hero">{s.value}</p>
            <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default StatsSection;
