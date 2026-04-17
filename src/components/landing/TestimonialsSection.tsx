import { motion } from "framer-motion";
import { Star } from "lucide-react";

const testimonials = [
  {
    name: "Thabo M.",
    role: "Spaza Shop Owner, Johannesburg",
    text: "I used to lose R2,000 a month from stock going missing. Verifin caught the discrepancies in the first week. Game changer.",
    stars: 5,
  },
  {
    name: "Grace C.",
    role: "Grocery Store, Harare",
    text: "I just type what I sold and everything updates. No more messy notebooks. My WhatsApp report every evening is my favourite feature.",
    stars: 5,
  },
  {
    name: "Sipho N.",
    role: "Hardware Store, Durban",
    text: "The barcode scanning is so fast. My staff can do stock counts in half the time, and I see discrepancies immediately.",
    stars: 5,
  },
];

const TestimonialsSection = () => {
  return (
    <section className="py-20 bg-background">
      <div className="container">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
            Trusted by business owners{" "}
            <span className="text-gradient-accent">across Africa</span>
          </h2>
        </motion.div>
        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="rounded-xl bg-card p-6 shadow-card hover:shadow-elevated transition-all hover:-translate-y-1"
            >
              <div className="flex gap-0.5 mb-4">
                {Array.from({ length: t.stars }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-accent text-accent" />
                ))}
              </div>
              <p className="text-foreground mb-5 leading-relaxed">"{t.text}"</p>
              <div>
                <p className="font-display font-semibold text-sm">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;