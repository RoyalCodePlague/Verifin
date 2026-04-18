import { motion } from "framer-motion";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";

const plans = [
  { name: "Starter", price: "Free", note: "Forever", features: ["1 user", "50 products", "Basic tracking"], popular: false },
  { name: "Growth", price: "R299", note: "/mo", features: ["3 users", "Unlimited products", "AI assistant", "WhatsApp reports"], popular: true },
  { name: "Business", price: "R599", note: "/mo", features: ["Unlimited users", "Advanced analytics", "API access", "Priority support"], popular: false },
];

const CTASection = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const primaryPath = isAuthenticated ? "/dashboard" : "/login?signup=1";
  const primaryLabel = isAuthenticated ? "Dashboard" : "Get Started Free";

  return (
    <section className="py-20">
      <div className="container">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-16">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-center mb-3">Simple Pricing</h2>
          <p className="text-muted-foreground text-center mb-8">Start free, upgrade when you're ready.</p>
          <div className="grid md:grid-cols-3 gap-4 max-w-3xl mx-auto">
            {plans.map((p) => (
              <Card key={p.name} className={`shadow-soft ${p.popular ? "ring-2 ring-primary relative" : ""}`}>
                {p.popular && <div className="absolute -top-2.5 left-1/2 -translate-x-1/2"><span className="bg-gradient-hero text-primary-foreground text-xs font-bold px-3 py-0.5 rounded-full flex items-center gap-1"><Sparkles className="h-3 w-3" /> Popular</span></div>}
                <CardContent className="p-5">
                  <h3 className="font-display font-semibold">{p.name}</h3>
                  <div className="mt-2 mb-3"><span className="font-display font-bold text-2xl">{p.price}</span><span className="text-sm text-muted-foreground">{p.note}</span></div>
                  <ul className="space-y-1.5">
                    {p.features.map(f => <li key={f} className="text-xs flex items-center gap-1.5"><Check className="h-3 w-3 text-success" />{f}</li>)}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="text-center mt-6">
            <Button variant="outline" onClick={() => navigate("/pricing")}>View Full Pricing <ArrowRight className="h-4 w-4 ml-1" /></Button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="rounded-2xl bg-gradient-hero p-10 md:p-16 text-center text-primary-foreground shadow-elevated">
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">Ready to take control of your business?</h2>
          <p className="text-primary-foreground/80 max-w-xl mx-auto mb-8 text-lg">Join thousands of SMEs using Verifin to automate admin, prevent stock losses, and grow smarter.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" onClick={() => navigate(primaryPath)} className="bg-accent text-accent-foreground hover:bg-accent/90 text-base px-8 h-12 shadow-elevated">
              {primaryLabel} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/demo")} className="text-base h-12 border-primary-foreground/30 bg-gradient-accent text-accent-foreground hover:opacity-90 border-0">
              Try the Demo
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
