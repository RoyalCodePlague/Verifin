import { motion } from "framer-motion";
import { ShieldCheck, Clock, Wifi, Lock } from "lucide-react";

const items = [
  { icon: ShieldCheck, title: "Bank-Level Security", desc: "Your data is encrypted end-to-end with AES-256 and stored securely in SOC 2 compliant infrastructure." },
  { icon: Clock, title: "99.9% Uptime SLA", desc: "Built on reliable cloud infrastructure with automatic failover and real-time monitoring." },
  { icon: Wifi, title: "Works Offline", desc: "Record sales and stock counts without internet. Everything syncs automatically when you're back online." },
  { icon: Lock, title: "Your Data, Your Control", desc: "Export your data anytime. We never sell or share your business information with third parties." },
];

const TrustSection = () => (
  <section className="py-16 bg-muted/30">
    <div className="container">
      <div className="text-center mb-12">
        <h2 className="font-display font-bold text-2xl sm:text-3xl mb-3">
          Built for <span className="text-gradient-hero">Trust</span> & Reliability
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto text-sm">Your business data deserves enterprise-grade protection, even at SME-friendly prices.</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {items.map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="text-center p-6 rounded-2xl bg-card border border-border shadow-soft"
          >
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <item.icon className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-display font-semibold text-sm mb-2">{item.title}</h3>
            <p className="text-xs text-muted-foreground">{item.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default TrustSection;
