import { Code, Key, Database, Webhook, Shield, Terminal, ShoppingCart, Boxes, ReceiptText, Cpu } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const endpoints = [
  { group: "Auth", method: "POST", path: "/api/v1/accounts/login/", desc: "Create JWT access and refresh tokens with owner email and password.", auth: false },
  { group: "Auth", method: "POST", path: "/api/v1/accounts/token/refresh/", desc: "Refresh an expired access token.", auth: false },
  { group: "Inventory", method: "GET", path: "/api/v1/inventory/products/", desc: "List products with stock, pricing, SKU, barcode, branch, and category data.", auth: true },
  { group: "Inventory", method: "POST", path: "/api/v1/inventory/products/", desc: "Create a product from an external catalog or POS back office.", auth: true },
  { group: "Inventory", method: "PATCH", path: "/api/v1/inventory/products/{id}/", desc: "Update product price, stock, barcode, reorder point, or status.", auth: true },
  { group: "Inventory", method: "GET", path: "/api/v1/inventory/products/barcode-lookup/?code={barcode}", desc: "Find a product by barcode before adding it to a POS basket.", auth: true },
  { group: "Inventory", method: "GET", path: "/api/v1/inventory/products/low-stock/", desc: "Fetch low-stock products for reorder prompts.", auth: true },
  { group: "Inventory", method: "POST", path: "/api/v1/inventory/movements/", desc: "Record stock adjustments, returns, shrinkage, and external stock movement.", auth: true },
  { group: "Sales", method: "GET", path: "/api/v1/sales/", desc: "List sales with date, customer, payment, and branch filters.", auth: true },
  { group: "Sales", method: "POST", path: "/api/v1/sales/", desc: "Create a completed sale and deduct inventory quantities.", auth: true },
  { group: "Sales", method: "GET", path: "/api/v1/sales/{id}/receipt/", desc: "Return receipt data for printing or reprint screens.", auth: true },
  { group: "Sales", method: "GET", path: "/api/v1/sales/tills/current/", desc: "Get the current till session for the authenticated business.", auth: true },
  { group: "Sales", method: "POST", path: "/api/v1/sales/tills/{id}/close/", desc: "Close a till session from an integrated POS terminal.", auth: true },
  { group: "Customers", method: "GET", path: "/api/v1/customers/", desc: "List customers with loyalty, credit, and purchase data.", auth: true },
  { group: "Customers", method: "POST", path: "/api/v1/customers/", desc: "Create or sync a customer from an external POS.", auth: true },
  { group: "Reports", method: "GET", path: "/api/v1/reports/daily-sales/", desc: "Daily sales summary for dashboards and close-of-day reports.", auth: true },
  { group: "Sync", method: "POST", path: "/api/v1/sync/push/", desc: "Push queued offline changes from a device.", auth: true },
  { group: "Sync", method: "GET", path: "/api/v1/sync/pull/", desc: "Pull server changes for offline-capable POS or stock devices.", auth: true },
];

const posSteps = [
  { icon: Key, title: "Authenticate", desc: "Login once, store the JWT securely, and send it as Authorization: Bearer <token>." },
  { icon: Boxes, title: "Sync Products", desc: "Pull products and barcode data before opening the till or when the POS comes online." },
  { icon: ShoppingCart, title: "Post Sales", desc: "Send each completed receipt to Verifin so inventory, customers, and reports stay current." },
  { icon: ReceiptText, title: "Print Receipts", desc: "Use the receipt endpoint to reprint or render a receipt in another POS application." },
];

const sampleSalePayload = `{
  "customer": 42,
  "payment_method": "cash",
  "discount": "0.00",
  "tax": "0.00",
  "items": [
    {
      "product": 101,
      "quantity": 2,
      "unit_price": "15.00"
    }
  ]
}`;

const pythonExample = `import requests

BASE_URL = "https://verifin-tau.vercel.app/api/v1"

tokens = requests.post(f"{BASE_URL}/accounts/login/", json={
    "email": "owner@example.com",
    "password": "your-password"
}).json()

headers = {"Authorization": f"Bearer {tokens['access']}"}

product = requests.get(
    f"{BASE_URL}/inventory/products/barcode-lookup/",
    params={"code": "6001234567890"},
    headers=headers,
).json()

sale = requests.post(
    f"{BASE_URL}/sales/",
    json={
        "payment_method": "cash",
        "items": [{
            "product": product["id"],
            "quantity": 1,
            "unit_price": product["selling_price"],
        }],
    },
    headers=headers,
).json()`;

const cExample = `#include <curl/curl.h>

int main(void) {
  CURL *curl = curl_easy_init();
  struct curl_slist *headers = NULL;

  headers = curl_slist_append(headers, "Content-Type: application/json");
  headers = curl_slist_append(headers, "Authorization: Bearer YOUR_ACCESS_TOKEN");

  const char *sale_json =
    "{\\"payment_method\\":\\"cash\\","
    "\\"items\\":[{\\"product\\":101,\\"quantity\\":1,\\"unit_price\\":\\"15.00\\"}]}";

  curl_easy_setopt(curl, CURLOPT_URL, "https://verifin-tau.vercel.app/api/v1/sales/");
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl, CURLOPT_POSTFIELDS, sale_json);
  curl_easy_perform(curl);

  curl_slist_free_all(headers);
  curl_easy_cleanup(curl);
  return 0;
}`;

const MethodBadge = ({ method }: { method: string }) => (
  <Badge className={`shrink-0 font-mono text-xs ${
    method === "GET" ? "bg-success/10 text-success hover:bg-success/10" :
    method === "POST" ? "bg-primary/10 text-primary hover:bg-primary/10" :
    method === "PATCH" ? "bg-warning/10 text-warning hover:bg-warning/10" :
    "bg-destructive/10 text-destructive hover:bg-destructive/10"
  }`}>{method}</Badge>
);

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
            { icon: Key, title: "Authentication", desc: "JWT bearer token from the login endpoint" },
            { icon: Database, title: "JSON Responses", desc: "All endpoints return JSON with pagination" },
            { icon: Shield, title: "Business Scope", desc: "Every request is limited to the signed-in business" },
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
            <code className="text-sm font-mono bg-muted px-3 py-2 rounded-lg block">https://verifin-tau.vercel.app/api/v1</code>
          </CardContent>
        </Card>

        <h2 className="font-display font-bold text-xl mb-4 flex items-center gap-2"><Code className="h-5 w-5 text-primary" /> Working Endpoints</h2>
        <Card className="shadow-soft overflow-hidden">
          <div className="divide-y divide-border">
            {endpoints.map((e, i) => (
              <div key={i} className="p-4 flex items-start gap-3 hover:bg-muted/30 transition-colors">
                <MethodBadge method={e.method} />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-sm font-mono">{e.path}</code>
                    <Badge variant="outline" className="text-[10px]">{e.group}</Badge>
                    {e.auth && <Badge variant="secondary" className="text-[10px]">Bearer token</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{e.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <h2 className="font-display font-bold text-xl mt-10 mb-4 flex items-center gap-2"><Cpu className="h-5 w-5 text-primary" /> POS API Integration</h2>
        <Card className="shadow-soft mb-8">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">
              Any POS that can send HTTPS requests can integrate with Verifin. That includes desktop tills, Android devices, scanners, embedded systems, Python services, C/C++ programs, Java, C#, PHP, Node.js, and low-code tools.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {posSteps.map((step) => (
                <div key={step.title} className="flex gap-3 rounded-lg border border-border bg-muted/20 p-4">
                  <div className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-primary/10">
                    <step.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-semibold">{step.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="shadow-soft">
            <CardContent className="p-5">
              <h3 className="font-display font-semibold mb-3">Sale Payload</h3>
              <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs"><code>{sampleSalePayload}</code></pre>
            </CardContent>
          </Card>
          <Card className="shadow-soft">
            <CardContent className="p-5">
              <h3 className="font-display font-semibold mb-3">POS Flow</h3>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p><strong className="text-foreground">1.</strong> Login with owner credentials or a dedicated integration user.</p>
                <p><strong className="text-foreground">2.</strong> Scan barcode and call product lookup.</p>
                <p><strong className="text-foreground">3.</strong> Build basket locally and post the sale when payment succeeds.</p>
                <p><strong className="text-foreground">4.</strong> Pull receipt data if your POS needs a printable copy.</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 mt-6">
          <Card className="shadow-soft">
            <CardContent className="p-5">
              <h3 className="font-display font-semibold mb-3">Python Example</h3>
              <pre className="max-h-[420px] overflow-auto rounded-lg bg-muted p-4 text-xs"><code>{pythonExample}</code></pre>
            </CardContent>
          </Card>
          <Card className="shadow-soft">
            <CardContent className="p-5">
              <h3 className="font-display font-semibold mb-3">C Example</h3>
              <pre className="max-h-[420px] overflow-auto rounded-lg bg-muted p-4 text-xs"><code>{cExample}</code></pre>
            </CardContent>
          </Card>
        </div>

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
