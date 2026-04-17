import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, Sparkles, CreditCard, X, WifiOff, ScanBarcode, MessageSquare, Users, ClipboardCheck, Shield, BarChart3, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const plans = [
  {
    name: "Starter",
    price: "Free",
    priceNote: "Forever",
    desc: "For solo entrepreneurs just getting started",
    color: "bg-blue-50 border-blue-200",
    features: [
      "✓ 1 user account",
      "✓ Up to 50 products",
      "✓ Basic sales recording",
      "✓ Daily sales summaries",
      "✓ Mobile app access (PWA)",
      "✓ Customer directory (up to 100)",
      "✓ Basic expense logging",
      "✓ Basic reports (2 types)",
      "✓ Community support",
    ],
    cta: "Get Started Free",
    popular: false,
  },
  {
    name: "Growth",
    price: "R299",
    priceNote: "/month",
    desc: "For growing businesses that need more power",
    color: "bg-emerald-50 border-emerald-200",
    features: [
      "✓ Up to 3 user accounts",
      "✓ Unlimited products",
      "✓ Admin Assistance System",
      "✓ Full inventory audits",
      "✓ Barcode scanning",
      "✓ Receipt OCR digitization",
      "✓ WhatsApp daily reports",
      "✓ QR customer loyalty system",
      "✓ 8 report types with charts",
      "✓ Low stock & discrepancy alerts",
      "✓ Unlimited customers",
      "✓ Priority email support",
    ],
    cta: "Start 14-Day Trial",
    popular: true,
  },
  {
    name: "Business",
    price: "R599",
    priceNote: "/month",
    desc: "For established businesses with multiple staff",
    color: "bg-purple-50 border-purple-200",
    features: [
      "✓ Unlimited users",
      "✓ Unlimited products",
      "✓ Smart insights & sales forecasting",
      "✓ Advanced analytics dashboard",
      "✓ Custom report builder",
      "✓ Role-based staff access",
      "✓ Offline mode with auto-sync",
      "✓ Automated background audits",
      "✓ Bulk product import/export",
      "✓ Excel report exports",
      "✓ API access for integrations",
      "✓ Dedicated account manager",
      "✓ Phone support",
    ],
    cta: "Start 14-Day Trial",
    popular: false,
  },
];

// Comprehensive feature matrix for comparison
const featureMatrix = [
  {
    category: "Core Features",
    features: [
      { name: "User Accounts", starter: "1", growth: "3", business: "Unlimited" },
      { name: "Products", starter: "50", growth: "Unlimited", business: "Unlimited" },
      { name: "Customers", starter: "100", growth: "Unlimited", business: "Unlimited" },
      { name: "Daily Transactions", starter: "Limited", growth: "Unlimited", business: "Unlimited" },
    ]
  },
  {
    category: "Sales & Inventory",
    features: [
      { name: "Sales Recording", starter: "Basic", growth: "Full", business: "Full + Forecasting" },
      { name: "Barcode Scanning", starter: false, growth: true, business: true },
      { name: "Inventory Audits", starter: "Manual", growth: "Automated", business: "Continuous" },
      { name: "Low Stock Alerts", starter: false, growth: true, business: true },
      { name: "Stock Reconciliation", starter: false, growth: true, business: true },
    ]
  },
  {
    category: "Reports & Analytics",
    features: [
      { name: "Report Types", starter: "2", growth: "8", business: "Custom Builder" },
      { name: "Charts & Graphs", starter: false, growth: true, business: true },
      { name: "Sales Analytics", starter: "Basic", growth: "Advanced", business: "AI-Powered" },
      { name: "Export to Excel", starter: false, growth: "Limited", business: true },
      { name: "Scheduled Reports", starter: false, growth: false, business: true },
    ]
  },
  {
    category: "Customer Management",
    features: [
      { name: "Customer Directory", starter: true, growth: true, business: true },
      { name: "Loyalty Points", starter: false, growth: true, business: true },
      { name: "QR Loyalty Cards", starter: false, growth: true, business: true },
      { name: "Purchase History", starter: "30 days", growth: "Unlimited", business: "Unlimited" },
    ]
  },
  {
    category: "Communication & Support",
    features: [
      { name: "WhatsApp Reports", starter: false, growth: true, business: true },
      { name: "Email Notifications", starter: "Basic", growth: "Advanced", business: "Advanced" },
      { name: "Support", starter: "Community", growth: "Email", business: "Email + Phone" },
      { name: "Dedicated Manager", starter: false, growth: false, business: true },
    ]
  },
  {
    category: "Advanced Features",
    features: [
      { name: "Admin Assistance System", starter: false, growth: true, business: true },
      { name: "Offline Mode", starter: false, growth: false, business: true },
      { name: "API Access", starter: false, growth: false, business: true },
      { name: "Custom Integrations", starter: false, growth: false, business: true },
      { name: "Receipt OCR", starter: false, growth: true, business: true },
    ]
  },
];

const Pricing = () => {
  const navigate = useNavigate();
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleCheckout = (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutLoading(true);
    setTimeout(() => {
      setCheckoutLoading(false);
      setCheckoutPlan(null);
      toast.success("Welcome aboard! Your trial has started.", { description: "You now have full access for 14 days." });
      navigate("/login?signup=1");
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="py-20 px-4">
        <div className="container max-w-5xl">
          <div className="text-center mb-12">
            <h1 className="font-display font-bold text-3xl sm:text-4xl mb-3">
              Simple, <span className="text-gradient-hero">Transparent</span> Pricing
            </h1>
            <p className="text-muted-foreground max-w-md mx-auto">No hidden fees. Start free, upgrade when you're ready.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {plans.map((plan, i) => (
              <motion.div key={plan.name} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                <Card className={`shadow-card h-full flex flex-col ${plan.popular ? "ring-2 ring-primary relative" : ""}`}>
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-gradient-hero text-primary-foreground text-xs font-bold px-4 py-1 rounded-full flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Most Popular
                      </span>
                    </div>
                  )}
                  <CardContent className="p-6 flex flex-col flex-1">
                    <h3 className="font-display font-semibold text-lg">{plan.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{plan.desc}</p>
                    <div className="mt-4 mb-6">
                      <span className="font-display font-bold text-3xl">{plan.price}</span>
                      <span className="text-sm text-muted-foreground">{plan.priceNote}</span>
                    </div>
                    <ul className="space-y-2.5 flex-1">
                      {plan.features.map(f => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                          <span>{f.replace('✓ ', '')}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      onClick={() => plan.price === "Free" ? navigate("/login?signup=1") : setCheckoutPlan(plan.name)}
                      className={`mt-6 w-full ${plan.popular ? "bg-gradient-hero text-primary-foreground" : ""}`}
                      variant={plan.popular ? "default" : "outline"}
                    >
                      {plan.cta}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Feature comparison */}
          <div className="mt-16 grid sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
            {[
              { icon: WifiOff, title: "Offline Mode", desc: "Record sales and stock without internet. Auto-syncs when back online.", badge: "Business" },
              { icon: ScanBarcode, title: "Barcode Scanning", desc: "Scan products with your phone camera for instant lookup and sales.", badge: "Growth & Business" },
              { icon: ClipboardCheck, title: "Smart Audits", desc: "Background audit engine detects discrepancies before they become losses.", badge: "Business" },
            ].map((item) => (
              <Card key={item.title} className="shadow-soft">
                <CardContent className="p-5 flex flex-col items-center text-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <item.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-display font-semibold text-sm">{item.title}</h3>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                  <Badge className="bg-primary/10 text-primary hover:bg-primary/10">{item.badge}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Detailed Feature Comparison */}
          <div className="mt-20">
            <div className="text-center mb-10">
              <h2 className="font-display font-bold text-2xl mb-2">Detailed Feature Comparison</h2>
              <p className="text-muted-foreground">See exactly what each plan includes</p>
            </div>
            
            {featureMatrix.map((section, idx) => (
              <div key={section.category} className="mb-8">
                <h3 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  {section.category}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 font-medium">Feature</th>
                        <th className="text-center py-3 px-4 font-medium">Starter</th>
                        <th className="text-center py-3 px-4 font-medium">Growth</th>
                        <th className="text-center py-3 px-4 font-medium">Business</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.features.map((feature) => (
                        <tr key={feature.name} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-3 px-4 font-medium text-foreground">{feature.name}</td>
                          <td className="text-center py-3 px-4">
                            {typeof feature.starter === 'boolean' ? (
                              feature.starter ? <Check className="h-5 w-5 text-success mx-auto" /> : <X className="h-5 w-5 text-muted-foreground mx-auto" />
                            ) : (
                              <span className="text-muted-foreground">{feature.starter}</span>
                            )}
                          </td>
                          <td className="text-center py-3 px-4">
                            {typeof feature.growth === 'boolean' ? (
                              feature.growth ? <Check className="h-5 w-5 text-success mx-auto" /> : <X className="h-5 w-5 text-muted-foreground mx-auto" />
                            ) : (
                              <span className="text-muted-foreground">{feature.growth}</span>
                            )}
                          </td>
                          <td className="text-center py-3 px-4">
                            {typeof feature.business === 'boolean' ? (
                              feature.business ? <Check className="h-5 w-5 text-success mx-auto" /> : <X className="h-5 w-5 text-muted-foreground mx-auto" />
                            ) : (
                              <span className="text-muted-foreground">{feature.business}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-16 px-4 bg-muted/30">
        <div className="container max-w-3xl">
          <h2 className="font-display font-bold text-2xl mb-8 text-center">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {[
              {
                q: "Can I change plans anytime?",
                a: "Yes! You can upgrade or downgrade your plan at any time. Changes take effect immediately and we'll prorate any deposits."
              },
              {
                q: "What happens to my data if I downgrade?",
                a: "Your data is always safe. If you downgrade, you'll have access to your historical data but may be limited by the tier's features."
              },
              {
                q: "Do you offer annual billing discounts?",
                a: "Contact our sales team for custom pricing on annual plans. We typically offer 20% off for annual commitments."
              },
              {
                q: "Is there a setup fee?",
                a: "No! Starter is completely free with no setup fees. Growth and Business plans include 14 days free to try before you're charged."
              },
              {
                q: "Can I export my data?",
                a: "Yes! All plans allow you to export your data. Business plan offers advanced export options to Excel and API access."
              },
            ].map((item, i) => (
              <Card key={i} className="shadow-soft">
                <CardContent className="p-5">
                  <h3 className="font-display font-semibold mb-2">{item.q}</h3>
                  <p className="text-sm text-muted-foreground">{item.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4">
        <div className="container max-w-2xl text-center">
          <h2 className="font-display font-bold text-3xl mb-4">Ready to grow your business?</h2>
          <p className="text-muted-foreground mb-6">Start free with Starter, or get full access for 14 days with Growth or Business.</p>
          <div className="flex gap-4 justify-center">
            <Button onClick={() => navigate("/login?signup=1")} className="bg-gradient-hero text-primary-foreground">
              Start Free Now
            </Button>
            <Button variant="outline" onClick={() => navigate("/contact")}>
              Talk to Sales
            </Button>
          </div>
        </div>
      </section>

      {/* Checkout Modal */}
      {checkoutPlan && (
        <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={() => setCheckoutPlan(null)}>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={e => e.stopPropagation()}
            className="bg-card rounded-2xl shadow-elevated max-w-md w-full"
          >
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                <h2 className="font-display font-semibold">Checkout — {checkoutPlan}</h2>
              </div>
              <button onClick={() => setCheckoutPlan(null)} title="Close checkout modal"><X className="h-5 w-5 text-muted-foreground" /></button>
            </div>
            <form onSubmit={handleCheckout} className="p-5 space-y-4">
              <div>
                <Label>Email</Label>
                <Input type="email" placeholder="you@business.com" required className="mt-1.5" />
              </div>
              <div>
                <Label>Card Number</Label>
                <Input placeholder="4242 4242 4242 4242" required className="mt-1.5" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Expiry</Label>
                  <Input placeholder="12/28" required className="mt-1.5" />
                </div>
                <div>
                  <Label>CVC</Label>
                  <Input placeholder="123" required className="mt-1.5" />
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                <div className="flex justify-between"><span>Plan</span><span className="font-medium">{checkoutPlan}</span></div>
                <div className="flex justify-between mt-1"><span>Trial</span><span className="font-medium text-success">14 days free</span></div>
                <div className="flex justify-between mt-1 font-display font-bold border-t border-border pt-2 mt-2">
                  <span>Due today</span><span>R0.00</span>
                </div>
              </div>
              <Button type="submit" className="w-full bg-gradient-hero text-primary-foreground" disabled={checkoutLoading}>
                {checkoutLoading ? "Processing..." : "Start Free Trial"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">Cancel anytime. No charge for 14 days.</p>
            </form>
          </motion.div>
        </div>
      )}
      <Footer />
    </div>
  );
};

export default Pricing;
