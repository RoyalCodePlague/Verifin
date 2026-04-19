import { useState } from "react";
import { Search, BookOpen, Package, ShoppingCart, BarChart3, Users, Settings, Shield, Smartphone, X } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const categories = [
  { icon: BookOpen, label: "Getting Started", articles: [
    { title: "How to set up your business profile", content: "Navigate to Settings from the dashboard sidebar. Enter your business name, select your currency, and add your product categories. You can also complete the onboarding wizard at /onboarding which guides you step-by-step through the entire setup process." },
    { title: "Understanding the dashboard", content: "The dashboard shows your key metrics: today's sales, inventory value, low stock alerts, and expenses. Use Quick Actions to navigate to common tasks. The AI Insights panel provides automated recommendations based on your data." },
    { title: "Adding your first products", content: "Go to the Inventory tab and click 'Add Product'. Enter the product name, category, stock quantity, reorder level, and price. The SKU is generated automatically. You can optionally add a barcode for faster scanning." },
    { title: "Recording your first sale", content: "Navigate to the Sales tab and click 'Record Sale'. Select products from your inventory, set quantities, choose the payment method, and confirm. Stock levels are automatically updated." },
  ]},
  { icon: Package, label: "Inventory Management", articles: [
    { title: "Adding and editing products", content: "Click 'Add Product' in the Inventory tab. Fill in the name, category, stock level, reorder point, and price. To edit, click the pencil icon on any product row. Changes are saved immediately." },
    { title: "Setting reorder levels", content: "Reorder levels trigger low-stock alerts. Set them based on your typical restocking frequency. When stock drops to or below the reorder level, the product is flagged as 'Low' and appears in notifications." },
    { title: "Using barcode scanning", content: "Click the 'Scan' button in Inventory to open the camera scanner. Point at any barcode — if the product exists, it's found instantly. If not, you can save the barcode with new product details for future recognition." },
    { title: "Understanding stock statuses", content: "Products have three statuses: 'In Stock' (green) means stock is above reorder level, 'Low' (amber) means stock is at or below reorder level, and 'Out' (red) means zero stock remaining." },
    { title: "Running stock audits", content: "Go to the Audits tab and click 'Start Audit'. The system scans all products, comparing expected vs actual stock levels. Discrepancies are flagged automatically. You can also enter manual counts." },
  ]},
  { icon: ShoppingCart, label: "Sales & Expenses", articles: [
    { title: "Recording sales manually", content: "In the Sales tab, click 'Record Sale'. Add products by selecting from your inventory, specify quantities, choose the payment method (Cash, EFT, or Card), and confirm. The sale is logged and stock is deducted automatically." },
    { title: "Using the Admin Assistant for sales", content: "On the Dashboard, type natural commands like 'Sold 3 bread for R54' into the Admin Assistant. It parses your input, records the sale, and updates inventory — no forms needed." },
    { title: "Tracking expenses by category", content: "In the Expenses tab, add expenses with a description, amount, and category (Transport, Utilities, Rent, etc.). Use search to filter expenses. All expenses appear in reports and affect your profit calculations." },
    { title: "Payment method tracking", content: "Each sale records the payment method. This helps you track cash vs digital payments. Reports break down sales by payment method for reconciliation." },
  ]},
  { icon: BarChart3, label: "Reports & Analytics", articles: [
    { title: "Exporting reports as CSV/Excel", content: "Go to the Reports tab and click 'Export CSV' on any report type. Files are downloaded as UTF-8 CSV that opens directly in Excel or Google Sheets. Available reports include daily sales, stock movement, expenses, customers, and profit/loss." },
    { title: "Understanding AI insights", content: "AI Insights appear on the dashboard and analyze your data automatically. They highlight trends (sales up/down), low stock warnings, top-selling products, and customer loyalty opportunities." },
    { title: "Sales trend analysis", content: "The Sales This Week chart on the dashboard shows daily sales volumes. Reports provide weekly performance breakdowns comparing sales vs expenses across the period." },
    { title: "Profit & loss overview", content: "The Profit & Loss report calculates: Revenue (total sales) minus Costs (total expenses) = Net Profit. Export this report for your accountant or tax records." },
  ]},
  { icon: Users, label: "Customers & Loyalty", articles: [
    { title: "Adding customers", content: "In the Customers tab, click 'Add Customer'. Enter their name, phone number, and assign a loyalty badge (Bronze, Silver, Gold, Platinum). A unique QR code is generated automatically for tracking." },
    { title: "QR code loyalty system", content: "Each customer gets a unique QR code. Scan it at checkout to track visits and spending. Loyalty points are earned at 1 point per R10 spent. Use points to offer discounts or credits." },
    { title: "Managing customer credits", content: "Click the gift icon on any customer card to add store credit. Credits are stored on their profile and can be applied at their next purchase. The credit balance is visible on their QR code." },
    { title: "Loyalty tier system explained", content: "Customers are assigned badges: Bronze (new), Silver (regular), Gold (loyal), and Platinum (VIP). You can set badges manually when adding or editing customers based on their relationship with your business." },
  ]},
  { icon: Settings, label: "Settings & Configuration", articles: [
    { title: "Changing currency and business name", content: "Go to Settings and update your business name and currency. Currency options include ZAR, USD, GBP, EUR, KES, NGN, ZWL, BWP, and TZS. Changes apply immediately across all pages." },
    { title: "Managing staff records", content: "In the Staff tab, add team members with roles like Owner, Manager, Cashier, or Stock Manager so you can track who works in the business and who is active." },
    { title: "Notification preferences", content: "In Settings, toggle WhatsApp daily summaries, low stock alerts, and discrepancy alerts on or off. When enabled, notifications appear in the bell icon on the navbar." },
    { title: "Dark mode toggle", content: "Click the sun/moon icon in the navbar or toggle dark mode in Settings. The entire app switches between light and dark themes with consistent colors." },
  ]},
  { icon: Shield, label: "Security & Privacy", articles: [
    { title: "Data encryption standards", content: "Verifin uses AES-256 encryption for data at rest and TLS 1.3 for data in transit. All connections are secured with HTTPS. Database backups are encrypted and stored in geographically distributed locations." },
    { title: "Two-factor authentication", content: "Two-factor authentication (2FA) adds an extra layer of security to your account. When enabled, you'll need to enter a verification code from your phone in addition to your password." },
    { title: "Data export and deletion", content: "You can export all your data at any time from the Reports tab. To delete your account, contact support. All data is permanently removed within 30 days of account deletion." },
    { title: "POPIA compliance", content: "Verifin complies with the Protection of Personal Information Act (POPIA). We collect only necessary data, store it securely, never sell it, and give you full control over your information." },
  ]},
  { icon: Smartphone, label: "Mobile & Offline", articles: [
    { title: "Installing as a PWA", content: "On your phone browser, tap 'Add to Home Screen' (Android) or the share button then 'Add to Home Screen' (iOS). Verifin installs as an app icon on your phone and works like a native app." },
    { title: "Offline mode explained", content: "Verifin works offline using local storage. You can record sales, update stock, and log expenses without internet. All changes are stored locally and persist until you're back online." },
    { title: "Syncing data after reconnection", content: "When your device reconnects to the internet, any offline changes are queued for sync. The sync happens automatically in the background. You'll see a notification when sync is complete." },
    { title: "Mobile-optimized features", content: "The app is fully responsive. On mobile, the sidebar collapses to a hamburger menu, tables scroll horizontally, and touch targets are optimized for finger taps. Barcode scanning uses the device camera." },
  ]},
];

const faqs = [
  { q: "Is Verifin free to use?", a: "Yes! The Starter plan is free forever and includes core features for 1 user with up to 50 products. Paid plans start at R299/month for additional features like AI insights, barcode scanning, and WhatsApp reports." },
  { q: "Can I use Verifin without internet?", a: "Yes. Verifin works offline-first. You can record sales, update stock, and log expenses without internet. Data is stored locally and will sync automatically when you reconnect." },
  { q: "How do I scan barcodes?", a: "Go to the Inventory tab and click the 'Scan' button. Grant camera access and point your device at a barcode. The system will recognize known products or let you save new ones with full product details." },
  { q: "Can I export my data?", a: "Yes. Go to the Reports tab and click 'Export' on any report type. Reports are downloaded as CSV files that open directly in Excel or Google Sheets with proper formatting." },
  { q: "How does the AI Assistant work?", a: "The Admin Assistant on the dashboard accepts natural language commands like 'Sold 3 bread for R54' or 'What's my inventory value?'. It automatically records transactions, updates stock, and answers business questions." },
  { q: "Is my data secure?", a: "Absolutely. We use AES-256 encryption at rest, TLS 1.3 in transit, and follow POPIA compliance standards. Your business data is never shared with third parties." },
];

const HelpCenter = () => {
  const [search, setSearch] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<{ title: string; content: string } | null>(null);

  const filteredCategories = categories.filter(c =>
    c.label.toLowerCase().includes(search.toLowerCase()) ||
    c.articles.some(a => a.title.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredFaqs = faqs.filter(f =>
    f.q.toLowerCase().includes(search.toLowerCase()) ||
    f.a.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <section className="py-16 px-4">
        <div className="container max-w-6xl">
          <div className="text-center mb-10">
            <h1 className="font-display font-bold text-3xl mb-3">Help Center</h1>
            <p className="text-muted-foreground mb-6">Find answers to common questions and learn how to get the most out of Verifin.</p>
            <div className="relative max-w-md mx-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search help articles..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 mb-12">
            {filteredCategories.map(c => (
              <Card key={c.label} className="shadow-soft hover:shadow-md transition-shadow h-full">
                <CardContent className="p-5">
                  <div className="h-11 w-11 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <c.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-display font-semibold text-base mb-3 leading-snug">{c.label}</h3>
                  <ul className="space-y-2">
                    {c.articles.filter(a => !search || a.title.toLowerCase().includes(search.toLowerCase()) || c.label.toLowerCase().includes(search.toLowerCase())).map(a => (
                      <li key={a.title}>
                        <button
                          onClick={() => setSelectedArticle(a)}
                          className="text-sm leading-snug text-muted-foreground hover:text-primary cursor-pointer transition-colors text-left w-full break-words"
                        >
                          &bull; {a.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>

          <h2 className="font-display font-bold text-xl mb-4">Frequently Asked Questions</h2>
          <Accordion type="single" collapsible className="space-y-2">
            {filteredFaqs.map((f, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="border rounded-lg px-4">
                <AccordionTrigger className="text-sm font-medium">{f.q}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className="mt-12 text-center p-8 rounded-2xl bg-muted/50">
            <h3 className="font-display font-semibold text-lg mb-2">Still need help?</h3>
            <p className="text-sm text-muted-foreground mb-4">Our support team is available Monday-Friday, 8am-5pm SAST.</p>
            <p className="text-sm"><strong>Email:</strong> robzmtambo@gmail.com &middot; <strong>Phone:</strong> +263 77 695 0947</p>
          </div>
        </div>
      </section>
      <Footer />

      {/* Article Detail Dialog */}
      <Dialog open={!!selectedArticle} onOpenChange={() => setSelectedArticle(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">{selectedArticle?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground leading-relaxed">{selectedArticle?.content}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HelpCenter;
