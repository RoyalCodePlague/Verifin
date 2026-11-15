import { ArrowRight, BarChart3, Boxes, ReceiptText, ShoppingCart, ChartNoAxesCombined } from "lucide-react";

const previews = [
  { title: "Business dashboard", detail: "Daily sales and stock at a glance", image: "/product-previews/dashboard.png", step: "dashboard", icon: ChartNoAxesCombined },
  { title: "Inventory", detail: "Spot in-stock, low-stock and empty items", image: "/product-previews/inventory.png", step: "inventory", icon: Boxes },
  { title: "Sales recording", detail: "Record an example sale and quantity", image: "/product-previews/sale.png", step: "sale", icon: ShoppingCart },
  { title: "Expense tracking", detail: "Log an example business expense", image: "/product-previews/expense.png", step: "expense", icon: ReceiptText },
  { title: "Reports", detail: "Review a sample sales summary", image: "/product-previews/reports.png", step: "reports", icon: BarChart3 },
];

const ProductShowcaseSection = () => (
  <section className="py-16 sm:py-20" aria-labelledby="product-showcase-title">
    <div className="container">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Inside Verifin</p>
          <h2 id="product-showcase-title" className="mt-3 font-display text-3xl font-bold md:text-4xl">See the work in one place</h2>
          <p className="mt-3 text-muted-foreground">A closer look at the screens for recording sales, managing stock, tracking expenses and reviewing results.</p>
        </div>
        <a href="/demo" className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-primary underline-offset-4 hover:underline">Open interactive tour <ArrowRight className="h-4 w-4" /></a>
      </div>
      <p className="mt-5 inline-flex rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">Screens shown use illustrative sample data, not a customer account.</p>
      <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {previews.map(({ title, detail, image, step, icon: Icon }) => (
          <a key={title} href={`/demo?step=${step}`} className="group overflow-hidden rounded-xl border border-border bg-card shadow-soft transition-shadow hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <div className="aspect-[1.7/1] overflow-hidden bg-muted/30 p-2">
              <img src={image} alt={`${title} screen in Verifin's interactive sample walkthrough`} loading="lazy" decoding="async" width="900" height="700" className="h-full w-full object-contain object-center transition-transform duration-300 group-hover:scale-[1.01]" />
            </div>
            <div className="flex items-start gap-3 p-4">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
              <div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>
            </div>
          </a>
        ))}
      </div>
      <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-xl bg-primary/5 p-5 sm:flex-row sm:items-center sm:p-6">
        <div><h3 className="font-semibold">Try the product flow yourself</h3><p className="mt-1 text-sm text-muted-foreground">Change the sample sale, inspect stock and move between product areas without signing in.</p></div>
        <a href="/demo" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Explore the demo <ArrowRight className="h-4 w-4" /></a>
      </div>
    </div>
  </section>
);

export default ProductShowcaseSection;
