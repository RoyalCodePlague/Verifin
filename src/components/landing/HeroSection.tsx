import { motion } from "framer-motion";
import { ArrowRight, Zap, Shield, TrendingUp, CheckCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";

const HeroSection = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const primaryPath = isAuthenticated ? "/dashboard" : "/login?signup=1";
  const primaryLabel = isAuthenticated ? "Dashboard" : "Start Free Trial";

  const particles = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    size: 4 + Math.random() * 12,
    left: Math.random() * 100,
    top: 20 + Math.random() * 60,
    duration: 6 + Math.random() * 8,
    delay: Math.random() * 5,
  }));

  return (
    <section className="relative overflow-hidden bg-background pt-20 pb-16 md:pt-28 md:pb-24">
      {/* Animated background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(152_55%_28%/0.06),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,hsl(38_92%_50%/0.04),transparent_60%)]" />
      
      {/* Floating particles */}
      {particles.map((p) => (
        <div
          key={p.id}
          className="particle"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.left}%`,
            top: `${p.top}%`,
            "--duration": `${p.duration}s`,
            "--delay": `${p.delay}s`,
          } as React.CSSProperties}
        />
      ))}

      <div className="container relative">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="text-center lg:text-left">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary mb-6"
            >
              <Zap className="h-3.5 w-3.5" /> Built for African SMEs
            </motion.div>
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
              <motion.span initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                Automate your admin,{" "}
              </motion.span>
              <motion.span initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="text-gradient-hero">
                control your stock,
              </motion.span>{" "}
              <motion.span initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
                stop losing money.
              </motion.span>
            </h1>
            <motion.p 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
              className="text-lg text-muted-foreground max-w-lg mx-auto lg:mx-0 mb-8"
            >
              Verifin is the all-in-one business operating system that handles your inventory, sales, expenses, and audits — so you can focus on growing your business.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }} className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Button size="lg" onClick={() => navigate(primaryPath)} className="bg-gradient-hero text-primary-foreground shadow-elevated hover:opacity-90 transition-opacity text-base px-8 h-12">
                {primaryLabel} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate("/demo")} className="text-base h-12 bg-gradient-accent text-accent-foreground border-0 hover:opacity-90">
                Try the Demo
              </Button>
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="flex items-center gap-6 mt-8 justify-center lg:justify-start text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5"><Shield className="h-4 w-4 text-primary" /> Offline-first</div>
              <div className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-primary" /> AI-powered</div>
            </motion.div>
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }} 
            animate={{ opacity: 1, scale: 1 }} 
            transition={{ duration: 0.8, delay: 0.3 }} 
            className="flex justify-center"
          >
            {/* Dashboard preview card */}
            <div className="w-full max-w-md lg:max-w-lg rounded-2xl shadow-elevated bg-card p-6 border border-border">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-8 w-8 rounded-lg bg-gradient-hero flex items-center justify-center text-primary-foreground">
                  <CheckCircle className="h-5 w-5" />
                </div>
                <span className="font-display font-semibold text-sm">Verifin Dashboard</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: "Today's Sales", value: "R2,486" },
                  { label: "Inventory", value: "128 items" },
                  { label: "Low Stock", value: "3 alerts" },
                  { label: "Net Profit", value: "R1,236" },
                ].map((m, i) => (
                  <motion.div 
                    key={m.label} 
                    initial={{ opacity: 0, y: 10 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    transition={{ delay: 0.8 + i * 0.15 }}
                    className="rounded-lg bg-muted/50 p-3"
                  >
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className="font-display font-bold text-sm mt-1">{m.value}</p>
                  </motion.div>
                ))}
              </div>
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}
                className="rounded-lg bg-primary/5 p-3 border border-primary/10"
              >
                <p className="text-xs text-primary font-medium flex items-center gap-1.5"><Sparkles className="h-3 w-3 flex-shrink-0" /> AI: "Bread is your top seller. Consider restocking — only 5 left."</p>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
