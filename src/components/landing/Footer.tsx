import { CheckCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Footer = () => {
  const navigate = useNavigate();

  return (
    <footer className="bg-sidebar text-sidebar-foreground py-16">
      <div className="container">
        <div className="grid md:grid-cols-4 gap-10 mb-12">
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground">
                <CheckCircle className="h-5 w-5" />
              </div>
              <span className="font-display font-bold text-lg">Verifin</span>
            </div>
            <p className="text-sm text-sidebar-foreground/60 leading-relaxed">
              The all-in-one business operating system built for African SMEs. Automate admin, control stock, stop losing money.
            </p>
          </div>
          <div>
            <h4 className="font-display font-semibold text-sm mb-4">Product</h4>
            <ul className="space-y-2.5 text-sm text-sidebar-foreground/60">
              <li><button onClick={() => navigate("/#features")} className="hover:text-sidebar-foreground transition-colors">Features</button></li>
              <li><button onClick={() => navigate("/pricing")} className="hover:text-sidebar-foreground transition-colors">Pricing</button></li>
              <li><button onClick={() => navigate("/demo")} className="hover:text-sidebar-foreground transition-colors">Demo</button></li>
              <li><button onClick={() => navigate("/api")} className="hover:text-sidebar-foreground transition-colors">API</button></li>
            </ul>
          </div>
          <div>
            <h4 className="font-display font-semibold text-sm mb-4">Company</h4>
            <ul className="space-y-2.5 text-sm text-sidebar-foreground/60">
              <li><button onClick={() => navigate("/about")} className="hover:text-sidebar-foreground transition-colors">About Us</button></li>
              <li><button onClick={() => navigate("/careers")} className="hover:text-sidebar-foreground transition-colors">Careers</button></li>
              <li><button onClick={() => navigate("/contact")} className="hover:text-sidebar-foreground transition-colors">Contact Us</button></li>
            </ul>
          </div>
          <div>
            <h4 className="font-display font-semibold text-sm mb-4">Support</h4>
            <ul className="space-y-2.5 text-sm text-sidebar-foreground/60">
              <li><button onClick={() => navigate("/help")} className="hover:text-sidebar-foreground transition-colors">Help Center</button></li>
              <li><button onClick={() => navigate("/privacy")} className="hover:text-sidebar-foreground transition-colors">Privacy Policy</button></li>
              <li><button onClick={() => navigate("/terms")} className="hover:text-sidebar-foreground transition-colors">Terms of Service</button></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-sidebar-border pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-sidebar-foreground/40">&copy; 2026 Verifin. Built for African businesses.</p>
          <div className="flex gap-4 text-sm text-sidebar-foreground/40">
            <span>South Africa</span>
            <span>Zimbabwe</span>
            <span>Kenya</span>
            <span>Nigeria</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
