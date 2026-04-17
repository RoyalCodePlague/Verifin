import { motion } from "framer-motion";
import {
  MessageSquare, ScanBarcode, WifiOff, BarChart3, Receipt, Bell,
} from "lucide-react";

const features = [
  // {
  //   icon: MessageSquare,
  //   title: "Auto Admin Assistant",
  //   description:
  //     'Just type "Sold 3 loaves for R90" and the system records everything — sales, stock, and receipts updated instantly.',
  // },
  {
    icon: ScanBarcode,
    title: "Smart Inventory Audits",
    description:
      "Real-time stock tracking with barcode scanning. Spot discrepancies, prevent theft, and never run out of key items.",
  },
  {
    icon: Receipt,
    title: "Receipt OCR",
    description:
      "Snap a photo of any receipt and let AI extract the amount, date, and category automatically.",
  },
  {
    icon: WifiOff,
    title: "Offline-First",
    description:
      "Keep working without internet. All data syncs automatically when you're back online — no data lost, ever.",
  },
  {
    icon: Bell,
    title: "WhatsApp Reports",
    description:
      "Get daily sales summaries, low stock alerts, and audit reports delivered straight to your WhatsApp.",
  },
  {
    icon: BarChart3,
    title: "Business Insights",
    description:
      "Smart alerts when stock is missing, sales are dropping, or expenses spike. Your business advisor.",
  },
];

const FeaturesSection = () => {
  return (
    <section className="py-20 bg-muted/50" id="features">
      <div className="container">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
            Everything your business needs,{" "}
            <span className="text-gradient-hero">in one place</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Built for the way African SMEs actually work — mobile-first, WhatsApp-connected, and reliable even offline.
          </p>
        </motion.div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="group rounded-xl bg-card p-6 shadow-card hover:shadow-elevated transition-all hover:-translate-y-1"
            >
              <div className="h-11 w-11 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-gradient-hero group-hover:text-primary-foreground transition-colors">
                <f.icon className="h-5 w-5 text-primary group-hover:text-primary-foreground" />
              </div>
              <h3 className="font-display text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{f.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;