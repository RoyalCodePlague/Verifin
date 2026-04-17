import { motion } from "framer-motion";

const stats = [
  { value: "2,500+", label: "Active Businesses" },
  { value: "R12M+", label: "Revenue Tracked" },
  { value: "99.9%", label: "Uptime" },
  { value: "4.9★", label: "User Rating" },
];

const StatsSection = () => (
  <section className="py-16 bg-muted/30">
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