import { useMemo, useState, type FormEvent } from "react";
import { Code, Key, Database, Webhook, Shield, Terminal, ShoppingCart, Boxes, ReceiptText, Cpu, Copy, Trash2, Play, Clock3 } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiBase } from "@/lib/api";

const endpoints = [
  { group: "General", method: "GET", path: "/api/v1/", desc: "Check the API service status and base routes.", auth: false },
  { group: "Auth", method: "POST", path: "/api/v1/accounts/login/", desc: "Create JWT access and refresh tokens with owner email and password.", auth: false },
  { group: "Auth", method: "POST", path: "/api/v1/accounts/token/refresh/", desc: "Refresh an expired access token.", auth: false },
  { group: "Inventory", method: "GET", path: "/api/v1/inventory/products/", desc: "List products with stock, pricing, SKU, barcode, branch, and category data.", auth: true },
  { group: "Inventory", method: "GET", path: "/api/v1/inventory/products/pos-catalog/", desc: "Fetch the paginated POS catalog; use updated_since for incremental refresh and available_only=false to include out-of-stock items.", auth: true },
  { group: "Inventory", method: "POST", path: "/api/v1/inventory/products/", desc: "Create a product from an external catalog or POS back office.", auth: true },
  { group: "Inventory", method: "PATCH", path: "/api/v1/inventory/products/{id}/", desc: "Update product price, stock, barcode, reorder point, or status.", auth: true },
  { group: "Inventory", method: "GET", path: "/api/v1/inventory/products/barcode-lookup/?code={barcode}", desc: "Find a product by barcode before adding it to a POS basket.", auth: true },
  { group: "Inventory", method: "GET", path: "/api/v1/inventory/products/pos-barcode-lookup/?code={barcode}", desc: "Look up a registered POS item barcode without enabling consumer barcode identification.", auth: true },
  { group: "Inventory", method: "GET", path: "/api/v1/inventory/products/low-stock/", desc: "Fetch low-stock products for reorder prompts.", auth: true },
  { group: "Inventory", method: "POST", path: "/api/v1/inventory/movements/", desc: "Record stock adjustments, returns, shrinkage, and external stock movement.", auth: true },
  { group: "Sales", method: "GET", path: "/api/v1/sales/", desc: "List sales with date, customer, payment, and branch filters.", auth: true },
  { group: "Sales", method: "POST", path: "/api/v1/sales/", desc: "Create a completed sale and deduct inventory quantities.", auth: true },
  { group: "Sales", method: "GET", path: "/api/v1/sales/{id}/receipt/", desc: "Return receipt data for printing or reprint screens.", auth: true },
  { group: "Sales", method: "GET", path: "/api/v1/sales/tills/current/", desc: "Get the current till session for the authenticated business.", auth: true },
  { group: "Sales", method: "GET", path: "/api/v1/sales/tills/summary/", desc: "Get the open till and business currency settings in one request.", auth: true },
  { group: "Sales", method: "POST", path: "/api/v1/sales/tills/", desc: "Open a till session for the shift.", auth: true },
  { group: "Sales", method: "POST", path: "/api/v1/sales/tills/{id}/close/", desc: "Close a till session from an integrated POS terminal.", auth: true },
  { group: "Customers", method: "GET", path: "/api/v1/customers/", desc: "List customers with loyalty, credit, and purchase data.", auth: true },
  { group: "Customers", method: "POST", path: "/api/v1/customers/", desc: "Create or sync a customer from an external POS.", auth: true },
  { group: "Reports", method: "GET", path: "/api/v1/reports/daily-sales/", desc: "Daily sales summary for dashboards and close-of-day reports.", auth: true },
  { group: "Sync", method: "POST", path: "/api/v1/sync/push/", desc: "Push queued offline changes from a device.", auth: true },
  { group: "Sync", method: "GET", path: "/api/v1/sync/pull/", desc: "Pull server changes for offline-capable POS or stock devices.", auth: true },
];

const posSteps = [
  { icon: Key, title: "Authenticate", desc: "Create a scoped API key in Settings and send it as X-API-Key." },
  { icon: Boxes, title: "Sync Products", desc: "Pull products and barcode data before opening the till or when the POS comes online." },
  { icon: ShoppingCart, title: "Post Sales", desc: "Send each completed receipt to Verifin so inventory, customers, and reports stay current." },
  { icon: ReceiptText, title: "Print Receipts", desc: "Use the receipt endpoint to reprint or render a receipt in another POS application." },
];

const sampleSalePayload = `{
  "customer": 42,
  "integration_id": "terminal-1:receipt-100045",
  "payment_method": "Cash",
  "items": [
    {
      "product": 101,
      "quantity": 2,
      "unit_price": "15.00"
    }
  ]
}`;

const pythonExample = `import os
import uuid
import requests

BASE_URL = os.getenv("VERIFIN_API", "https://verifin-tau.vercel.app/api/v1")
headers = {"X-API-Key": os.environ["VERIFIN_API_KEY"]}

product = requests.get(
    f"{BASE_URL}/inventory/products/pos-barcode-lookup/",
    params={"code": "6001234567890"},
    headers=headers,
).json()

sale = requests.post(
    f"{BASE_URL}/sales/",
    json={
        "integration_id": "terminal-1:" + str(uuid.uuid4()),
        "payment_method": "Cash",
        "items": [{
            "product": product["id"],
            "quantity": 1,
            "unit_price": product["price"],
        }],
    },
    headers=headers,
).json()`;

const cExample = `#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
  const char *api_key = getenv("VERIFIN_API_KEY");
  if (!api_key) return 1;
  CURL *curl = curl_easy_init();
  if (!curl) return 1;
  struct curl_slist *headers = NULL;

  headers = curl_slist_append(headers, "Content-Type: application/json");
  char auth_header[256];
  snprintf(auth_header, sizeof(auth_header), "X-API-Key: %s", api_key);
  headers = curl_slist_append(headers, auth_header);

  const char *sale_json =
    "{\\"integration_id\\":\\"terminal-1:receipt-100045\\","
    "\\"payment_method\\":\\"Cash\\","
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

type ApiResponse = { status: number; statusText: string; duration: number; body: string };

const ApiTerminal = () => {
  const [selected, setSelected] = useState("0");
  const [method, setMethod] = useState(endpoints[0].method);
  const [path, setPath] = useState(endpoints[0].path);
  const [authType, setAuthType] = useState<"none" | "api-key" | "bearer">("none");
  const [credential, setCredential] = useState("");
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const origin = useMemo(() => apiBase() || (typeof window !== "undefined" ? window.location.origin : ""), []);

  const chooseEndpoint = (value: string) => {
    const index = Number(value);
    const endpoint = endpoints[index];
    if (!endpoint) return;
    setSelected(value);
    setMethod(endpoint.method);
    setPath(endpoint.path);
    setBody(endpoint.method === "POST" || endpoint.method === "PATCH" ? (endpoint.path === "/api/v1/sales/" ? sampleSalePayload : "{}") : "");
    setError("");
  };

  const sendRequest = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setResponse(null);
    if (!path.startsWith("/api/v1/") || path.startsWith("//") || path.includes("\\")) {
      setError("Use a path under /api/v1/. Full URLs are not allowed.");
      return;
    }
    let requestBody: string | undefined;
    if (method !== "GET" && body.trim()) {
      try {
        requestBody = JSON.stringify(JSON.parse(body));
      } catch {
        setError("Request body must be valid JSON.");
        return;
      }
    }

    if (method !== "GET" && !window.confirm(`Send this ${method} request to ${path}? It may change live business data.`)) {
      return;
    }

    const headers = new Headers({ Accept: "application/json" });
    if (requestBody) headers.set("Content-Type", "application/json");
    if (credential.trim() && authType === "api-key") headers.set("X-API-Key", credential.trim());
    if (credential.trim() && authType === "bearer") headers.set("Authorization", `Bearer ${credential.trim()}`);

    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    setBusy(true);
    try {
      const url = new URL(path, origin);
      const result = await fetch(url, {
        method,
        headers,
        body: requestBody,
        signal: controller.signal,
        credentials: "omit",
      });
      const raw = await result.text();
      let formatted = raw;
      try { formatted = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* Preserve plain text and HTML errors. */ }
      setResponse({ status: result.status, statusText: result.statusText, duration: Math.round(performance.now() - startedAt), body: formatted || "(empty response)" });
    } catch (requestError) {
      const message = requestError instanceof Error && requestError.name === "AbortError"
        ? "Request timed out after 30 seconds."
        : requestError instanceof Error ? requestError.message : "Request failed.";
      setError(`${message} Check the API service and browser network access.`);
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  };

  const copyResponse = async () => {
    if (!response) return;
    try { await navigator.clipboard.writeText(response.body); } catch { setError("Could not access the clipboard in this browser."); }
  };

  const mutation = method !== "GET";
  return (
    <Card className="shadow-soft mb-12 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Terminal className="h-4 w-4" /></div>
          <div><h2 className="font-display font-semibold">API Test Terminal</h2><p className="text-xs text-muted-foreground">Requests go to {origin}</p></div>
        </div>
        <Badge variant="outline" className="font-mono">API v1</Badge>
      </div>
      <CardContent className="space-y-5 p-5">
        <form onSubmit={sendRequest} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
            <label className="space-y-1.5 text-sm font-medium">Endpoint preset
              <select aria-label="Endpoint preset" value={selected} onChange={event => chooseEndpoint(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal">
                {endpoints.map((item, index) => <option key={`${item.method} ${item.path} ${index}`} value={String(index)}>{item.method} · {item.path}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium">Method
              <select aria-label="Request method" value={method} onChange={event => setMethod(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono font-normal">
                {["GET", "POST", "PATCH", "DELETE"].map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">Request path
            <input aria-label="Request path" value={path} onChange={event => setPath(event.target.value)} spellCheck={false} className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm font-normal" placeholder="/api/v1/inventory/products/" />
          </label>
          <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
            <label className="space-y-1.5 text-sm font-medium">Authentication
              <select aria-label="Authentication type" value={authType} onChange={event => setAuthType(event.target.value as typeof authType)} className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal">
                <option value="none">No authentication</option><option value="api-key">X-API-Key</option><option value="bearer">Bearer token</option>
              </select>
            </label>
            {authType !== "none" && <label className="space-y-1.5 text-sm font-medium">{authType === "api-key" ? "API key" : "Access token"}
              <input aria-label={authType === "api-key" ? "API key" : "Access token"} type="password" autoComplete="off" value={credential} onChange={event => setCredential(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm font-normal" placeholder="Credential is kept in this page only" />
            </label>}
          </div>
          {method !== "GET" && <label className="block space-y-1.5 text-sm font-medium">JSON body
            <textarea aria-label="JSON request body" value={body} onChange={event => setBody(event.target.value)} spellCheck={false} rows={9} className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed" placeholder={'{\n  "example": true\n}'} />
          </label>}
          {mutation && <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">This {method} request can change live business data. Use test credentials and verify the path and body before sending.</p>}
          {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy} className="gap-2"><Play className="h-4 w-4" />{busy ? "Sending…" : "Send request"}</Button>
            <p className="text-xs text-muted-foreground">Credentials stay in page memory and are never saved to storage.</p>
          </div>
        </form>
        <section aria-label="Response" className="overflow-hidden rounded-lg border border-border">
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium"><span>Response</span>{response && <Badge variant={response.status < 400 ? "secondary" : "destructive"}>{response.status} {response.statusText}</Badge>}{response && <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{response.duration} ms</span>}</div>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" disabled={!response} onClick={() => void copyResponse()} aria-label="Copy response"><Copy className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="sm" disabled={!response && !error} onClick={() => { setResponse(null); setError(""); }} aria-label="Clear response"><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          <pre aria-live="polite" className="min-h-28 max-h-[480px] overflow-auto bg-background p-4 text-xs leading-relaxed text-foreground"><code>{response?.body ?? (error || "Send a request to inspect the response.")}</code></pre>
        </section>
      </CardContent>
    </Card>
  );
};

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

        <ApiTerminal />

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

        <h2 className="font-display font-bold text-xl mb-4 flex items-center gap-2"><Code className="h-5 w-5 text-primary" /> API Endpoints</h2>
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
              Create a dedicated API key in Settings → API Access. Send it in X-API-Key on every request and grant Inventory and Sales for catalog lookup, checkout, and tills. Keep it in secure device storage, not source code. Send a stable unique integration_id with each completed receipt so retries never deduct stock twice.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              The full key is shown only once when created. Save it securely and reuse it for requests; Settings only shows its prefix afterward. If it is lost, create a replacement and revoke the old key. Use separate keys for separate terminals so one can be revoked without interrupting the others.
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
                <p><strong className="text-foreground">1.</strong> Create and securely save a scoped API key; it is shown once. Reuse it as X-API-Key on each request.</p>
                <p><strong className="text-foreground">2.</strong> Load the POS catalog and scan barcodes to look up items.</p>
                <p><strong className="text-foreground">3.</strong> Open a till, build the basket locally, and post with a stable integration_id after payment succeeds.</p>
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
          <p className="text-sm text-muted-foreground">Upgrade to the Business plan to enable API Access, then create and manage scoped integration keys in Settings.</p>
        </div>
      </div>
    </section>
    <Footer />
  </div>
);

export default ApiDocs;
