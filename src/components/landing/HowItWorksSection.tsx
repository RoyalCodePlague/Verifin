import { motion } from "framer-motion";
import { MessageSquare, BarChart3, Shield, Zap } from "lucide-react";

const steps = [
  { icon: Zap, title: "Set Up in 2 Minutes", desc: "Enter your business name, currency, and add your first products. You're ready to go." },
  { icon: MessageSquare, title: "Record Everything by Talking", desc: 'Just type "Sold 5 bread for R90" — Verifin handles inventory, receipts, and reports automatically.' },
  { icon: Shield, title: "Audit & Control Stock", desc: "Run stock counts, detect discrepancies instantly, and prevent losses with smart alerts." },
  { icon: BarChart3, title: "Grow with Insights", desc: "Smart reports show trends, predict low stock, and help you make smarter business decisions." },
];

const HowItWorksSection = () => (
  <section className="py-20 bg-background">
    <div className="container">
      <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-14">
        <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
          How <span className="text-gradient-accent">Verifin</span> Works
        </h2>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg">Four simple steps to transforming your business operations.</p>
      </motion.div>
      <div className="grid md:grid-cols-4 gap-8 max-w-4xl mx-auto">
        {steps.map((s, i) => (
          <motion.div key={s.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="text-center">
            <div className="relative mx-auto mb-4">
              <div className="h-14 w-14 rounded-2xl bg-gradient-hero flex items-center justify-center text-primary-foreground mx-auto">
                <s.icon className="h-6 w-6" />
              </div>
              <span className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-accent text-accent-foreground text-xs font-bold flex items-center justify-center">{i + 1}</span>
            </div>
            <h3 className="font-display font-semibold text-sm mb-2">{s.title}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default HowItWorksSection;