import { Code, Key, Database, Webhook, Shield, Terminal } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const endpoints = [
  { method: "GET", path: "/api/v1/products", desc: "List all products with stock levels and statuses", auth: true },
  { method: "POST", path: "/api/v1/products", desc: "Create a new product with auto-generated SKU", auth: true },
  { method: "PUT", path: "/api/v1/products/:id", desc: "Update product details, stock, or barcode", auth: true },
  { method: "DELETE", path: "/api/v1/products/:id", desc: "Remove a product from inventory", auth: true },
  { method: "GET", path: "/api/v1/sales", desc: "List sales with optional date filtering", auth: true },
  { method: "POST", path: "/api/v1/sales", desc: "Record a new sale transaction", auth: true },
  { method: "GET", path: "/api/v1/expenses", desc: "List expenses by category and date range", auth: true },
  { method: "POST", path: "/api/v1/expenses", desc: "Log a new expense", auth: true },
  { method: "GET", path: "/api/v1/customers", desc: "List customers with loyalty data", auth: true },
  { method: "GET", path: "/api/v1/reports/summary", desc: "Get dashboard summary metrics", auth: true },
  { method: "POST", path: "/api/v1/audits", desc: "Start a new stock audit", auth: true },
  { method: "GET", path: "/api/v1/barcode/:code", desc: "Look up a product by barcode", auth: true },
];

const ApiDocs = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="py-16 px-4">
      <div className="container max-w-4xl">
        <div className="text-center mb-12">
          <h1 className="font-display font-bold text-3xl mb-3">API Documentation</h1>
          <p className="text-muted-foreground max-w-lg mx-auto">Integrate Verifin with your existing tools using our RESTful API. Available on the Business plan.</p>
          <Badge className="mt-3 bg-primary/10 text-primary hover:bg-primary/10">Business Plan Required</Badge>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mb-12">
          {[
            { icon: Key, title: "Authentication", desc: "Bearer token via API key from Settings" },
            { icon: Database, title: "JSON Responses", desc: "All endpoints return JSON with pagination" },
            { icon: Shield, title: "Rate Limiting", desc: "1,000 requests/minute per API key" },
          ].map(f => (
            <Card key={f.title} className="shadow-soft">
              <CardContent className="p-5 text-center">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-display font-semibold text-sm mb-1">{f.title}</h3>
                <p className="text-xs text-muted-foreground">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <h2 className="font-display font-bold text-xl mb-4 flex items-center gap-2"><Terminal className="h-5 w-5 text-primary" /> Base URL</h2>
        <Card className="shadow-soft mb-8">
          <CardContent className="p-4">
            <code className="text-sm font-mono bg-muted px-3 py-2 rounded-lg block">https://api.verifin.co.za/api/v1</code>
          </CardContent>
        </Card>

        <h2 className="font-display font-bold text-xl mb-4 flex items-center gap-2"><Code className="h-5 w-5 text-primary" /> Endpoints</h2>
        <Card className="shadow-soft overflow-hidden">
          <div className="divide-y divide-border">
            {endpoints.map((e, i) => (
              <div key={i} className="p-4 flex items-start gap-3 hover:bg-muted/30 transition-colors">
                <Badge className={`shrink-0 font-mono text-xs ${
                  e.method === "GET" ? "bg-success/10 text-success hover:bg-success/10" :
                  e.method === "POST" ? "bg-primary/10 text-primary hover:bg-primary/10" :
                  e.method === "PUT" ? "bg-warning/10 text-warning hover:bg-warning/10" :
                  "bg-destructive/10 text-destructive hover:bg-destructive/10"
                }`}>{e.method}</Badge>
                <div>
                  <code className="text-sm font-mono">{e.path}</code>
                  <p className="text-xs text-muted-foreground mt-1">{e.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <h2 className="font-display font-bold text-xl mt-10 mb-4 flex items-center gap-2"><Webhook className="h-5 w-5 text-primary" /> Webhooks</h2>
        <Card className="shadow-soft">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-3">Subscribe to real-time events for your business:</p>
            <div className="space-y-2">
              {["sale.created", "product.low_stock", "product.out_of_stock", "audit.completed", "expense.created"].map(ev => (
                <div key={ev} className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  <code className="text-sm font-mono">{ev}</code>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="mt-10 text-center p-8 rounded-2xl bg-muted/50">
          <h3 className="font-display font-semibold text-lg mb-2">Need API access?</h3>
          <p className="text-sm text-muted-foreground">Upgrade to the Business plan to get your API key. Contact <strong>robzmtambo@gmail.com</strong> for enterprise integrations.</p>
        </div>
      </div>
    </section>
    <Footer />
  </div>
);

export default ApiDocs;
