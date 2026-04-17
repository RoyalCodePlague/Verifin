import { motion } from "framer-motion";
import { Target, Users, Globe, Lightbulb, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const values = [
  { icon: Target, title: "Built for Africa", desc: "Designed for the realities of SME operations across South Africa, Zimbabwe, Kenya, Nigeria, and beyond." },
  { icon: Users, title: "Human-Centered", desc: "Every feature starts with a real business owner's pain point. We build what matters, not what's trendy." },
  { icon: Globe, title: "Offline-First", desc: "Your business doesn't stop when the internet does. Verifin works offline and syncs when you're back online." },
  { icon: Lightbulb, title: "AI-Powered", desc: "Smart automation that handles admin so you can focus on growing your business." },
];

const team = [
  { name: "Thabo M.", role: "Founder & CEO", initials: "TM" },
  { name: "Amara K.", role: "Head of Product", initials: "AK" },
  { name: "Sipho N.", role: "Lead Engineer", initials: "SN" },
  { name: "Grace C.", role: "Customer Success", initials: "GC" },
];

const About = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="py-20 px-4">
        <div className="container max-w-4xl">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16">
            <h1 className="font-display font-bold text-3xl sm:text-4xl mb-4">
              Empowering <span className="text-gradient-hero">African SMEs</span> to Thrive
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Verifin was born from a simple observation: millions of small businesses across Africa lose money every day due to manual admin, stock shrinkage, and lack of visibility. We're here to change that.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 gap-6 mb-16">
            {values.map((v, i) => (
              <motion.div key={v.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                <Card className="shadow-soft h-full">
                  <CardContent className="p-6">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                      <v.icon className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-display font-semibold mb-1">{v.title}</h3>
                    <p className="text-sm text-muted-foreground">{v.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <div className="mb-16">
            <h2 className="font-display font-bold text-2xl text-center mb-8">Our Team</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {team.map((t, i) => (
                <motion.div key={t.name} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.1 }} className="text-center">
                  <div className="h-16 w-16 rounded-full bg-gradient-hero flex items-center justify-center text-primary-foreground font-display font-bold text-lg mx-auto mb-3">
                    {t.initials}
                  </div>
                  <p className="font-display font-semibold text-sm">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="text-center bg-gradient-hero rounded-2xl p-10 text-primary-foreground">
            <h2 className="font-display font-bold text-2xl mb-2">Ready to take control?</h2>
            <p className="text-primary-foreground/80 mb-6">Join thousands of African businesses using Verifin.</p>
            <Button onClick={() => navigate("/pricing")} className="bg-card text-foreground hover:bg-card/90">
              View Pricing <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default About;