import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SITE_URL = "https://verifin.co.zw";
const IMAGE_URL = `${SITE_URL}/og-image.png`;
const distDir = path.resolve("dist");

const routes = [
  {
    path: "/privacy",
    title: "Privacy Policy | Verifin",
    description: "Read how Verifin collects, uses and protects your account and business information, and learn about your privacy choices.",
    heading: "Privacy Policy",
    body: "Learn about the account and business information Verifin processes, how it is used, and your privacy choices.",
    cta: "Contact the team with privacy questions.",
  },
  {
    path: "/terms",
    title: "Terms of Service | Verifin",
    description: "Read the terms for using Verifin, including accounts, subscriptions, acceptable use and responsibilities.",
    heading: "Terms of Service",
    body: "Review the terms governing your use of Verifin, including accounts, subscriptions and acceptable use.",
    cta: "Contact the team if you have questions about these terms.",
  },
  {
    path: "/security",
    title: "Security Center | Verifin",
    description: "See the account and access controls verified in Verifin, plus the hosting and recovery practices that still need confirmation.",
    heading: "Security Center",
    body: "Learn how Verifin handles sign-in, account permissions, and business records, and which hosting, backup, and account-deletion practices still need confirmation.",
    cta: "Report a security concern to verifin2026@gmail.com.",
  },
  {
    path: "/",
    title: "Stock, Sales and Expenses for Zimbabwe Shops | Verifin",
    description: "Know what you sold, what is in stock, and where your money went. Verifin helps Zimbabwe shops track sales, stock and expenses, even with unreliable internet.",
    heading: "Know what you sold, what is left, and where your money went.",
    body: "Verifin helps grocery shops, hardware stores, boutiques, tuckshops and bakeries keep sales, stock and expenses clear in one place.",
    keywords: ["inventory management", "sales tracking", "expense tracking", "stock audits", "offline business app", "African SMEs"],
    cta: "Start free or try the interactive demo.",
  },
  {
    path: "/pricing",
    title: "Verifin Pricing | Plans for Zimbabwe Shops",
    description: "Compare Verifin Starter, Growth and Business plans, preset regional prices, payment availability, promotion terms and billing periods.",
    heading: "Verifin Pricing",
    body: "Compare plans and limits. Prices are preset by region rather than converted at a daily exchange rate; Zimbabwe paid plans are listed in USD. Paynow checkout supports paid USD plans when configured.",
    keywords: ["Verifin pricing", "inventory software pricing", "SME business software plans"],
    cta: "Start free and review Paynow checkout options from Billing.",
  },
  {
    path: "/features",
    title: "Verifin Features | Stock, Sales and Expenses",
    description: "See how Verifin helps shops record sales, keep stock in view, track expenses and review business performance, even when the internet drops.",
    heading: "Keep the work behind every sale clear",
    body: "Record daily sales, check what is running low, log expenses and understand how your shop is doing.",
    keywords: ["shop inventory", "sales and expense tracking", "offline shop software"],
    cta: "Try the interactive demo without creating an account.",
  },
  {
    path: "/demo",
    title: "Verifin Demo - See Inventory, Sales, Audits and Reports",
    description: "Try the Verifin product tour with illustrative sample data for sales, stock, expenses, dashboard summaries and reports.",
    heading: "Interactive Verifin Product Tour",
    body: "See how Verifin records sales, updates stock, tracks expenses, runs audits, supports customer loyalty, and turns business activity into reports.",
    keywords: ["inventory app demo", "sales tracking demo", "stock audit demo"],
    cta: "Try the demo and see the workflow in action.",
  },
  {
    path: "/about",
    title: "About Verifin - Business Software Built for African SMEs",
    description: "Learn what Verifin is, why it is being built, the business problems it aims to solve, and who it is designed to serve.",
    heading: "About Verifin",
    body: "Verifin is built for the realities of African SMEs: mobile-first workflows, offline reliability, inventory visibility, admin automation, and smarter daily decisions.",
    keywords: ["African SME software", "business software Africa", "offline inventory app"],
    cta: "Learn why Verifin exists and who it serves.",
  },
  {
    path: "/contact",
    title: "Contact Verifin - Talk to Our SME Software Team",
    description: "Contact Verifin for questions about inventory management, sales tracking, admin automation, pricing, and business software support.",
    heading: "Contact Verifin",
    body: "Talk to the Verifin team about inventory management, sales tracking, admin automation, pricing, support, and integrations for your business.",
    keywords: ["contact Verifin", "Verifin support", "inventory software support"],
    cta: "Email the team or open WhatsApp to ask for help.",
  },
  {
    path: "/help",
    title: "Verifin Help Center - Inventory and Admin Support",
    description: "Find Verifin support articles for inventory, sales, expenses, audits, reports, offline mode, and app installation.",
    heading: "Verifin Help Center",
    body: "Find help for inventory tracking, sales, expenses, stock audits, reports, offline mode, PWA installation, barcode scanning, and business insights.",
    keywords: ["Verifin help", "inventory app support", "business app help center"],
    cta: "Search support articles and learn the app.",
  },
  {
    path: "/api",
    title: "Verifin API - Business Data Integrations",
    description: "Explore Verifin API access for inventory, sales, expenses, customers, audits, reports, and business integrations.",
    heading: "Verifin API",
    body: "Use the Verifin API to integrate business data across products, sales, expenses, customers, reports, audits, and external tools.",
    keywords: ["Verifin API", "inventory API", "business software API"],
    cta: "Explore API access for Business plan integrations.",
  },
  {
    path: "/careers",
    title: "Verifin Careers - Build Software for African SMEs",
    description: "Join Verifin and help build practical business software for African SMEs.",
    heading: "Careers at Verifin",
    body: "Join Verifin to build practical inventory, admin, and business operations software for African SMEs.",
    keywords: ["Verifin careers", "software jobs Africa", "SME software careers"],
    cta: "See opportunities to help build Verifin.",
  },
];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setTag(html, pattern, replacement) {
  return pattern.test(html) ? html.replace(pattern, replacement) : html.replace("</head>", `    ${replacement}\n  </head>`);
}

function staticMarkup(route) {
  if (route.path === "/") {
    return `
      <main class="seo-prerender" aria-label="Verifin business software">
        <section>
          <h1>Know what you sold, what is left, and where your money went.</h1>
          <p>Verifin helps grocery shops, hardware stores, boutiques, tuckshops and bakeries keep sales, stock and expenses clear in one place.</p>
          <p><a href="/login?signup=1">Start free</a> · <a href="/demo">Explore the interactive demo</a></p>
        </section>
        <section>
          <h2>No data? Keep selling.</h2>
          <p>Save supported sales, stock updates and expenses on your device. They sync when you reconnect.</p>
          <h2>Know what is running low</h2>
          <p>Keep product records together, see low-stock items and review stock counts alongside your sales.</p>
          <h2>See where the money went</h2>
          <p>Record sales and expenses, then use clear summaries to understand how your shop is doing.</p>
          <h2>Explore Verifin</h2>
          <p>Try a sample sale, stock update and business summary in the interactive demo. No account needed.</p>
          <h2>Trust and transparency</h2>
          <p>Read how account permissions work in the application, what remains to be verified about hosting and recovery, and how regional plan prices are set.</p>
          <nav aria-label="Explore Verifin"><a href="/features">Features</a> | <a href="/pricing">Pricing</a> | <a href="/demo">Product demo</a> | <a href="/about">About</a> | <a href="/contact">Contact</a> | <a href="/help">Help Center</a> | <a href="/security">Security</a> | <a href="/privacy">Privacy</a> | <a href="/terms">Terms</a></nav>
        </section>
      </main>
    `;
  }
  if (route.path === "/pricing") {
    const plans = [
      { name: "Starter", price: "Free", period: "forever", detail: "For solo shop owners getting started", features: ["1 user", "Up to 50 products", "Up to 100 customers", "Basic sales and expenses", "Daily summaries"] },
      { name: "Growth", price: "$12 USD", period: "per month", detail: "For growing shops", features: ["Up to 3 users", "Unlimited products and customers", "Inventory audits and low-stock alerts", "Advanced reports and insights"] },
      { name: "Business", price: "$24 USD", period: "per month", detail: "For established teams", features: ["Unlimited users", "Everything in Growth", "Staff roles and branch controls", "Custom reports and Excel exports", "API access and automation tools"] },
    ];
    return `
      <main class="seo-prerender" aria-label="Verifin pricing">
        <section><p>Pricing · Zimbabwe (USD)</p><h1>Start free. Upgrade when your shop is ready.</h1><p>For grocery shops, hardware stores, boutiques, tuckshops and bakeries. Review your plan and Paynow checkout options in Billing.</p></section>
        <p>Regional prices are preset, not converted using a daily exchange rate. Zimbabwe paid plans are listed in USD; a ZiG equivalent is not automatically calculated. Paynow checkout must be enabled and configured and currently accepts paid USD plans only.</p>
        <section aria-label="Plans" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">
          ${plans.map((plan) => `<article><h2>${plan.name}</h2><p>${plan.detail}</p><p><strong>${plan.price}</strong> ${plan.period}</p><ul>${plan.features.map((feature) => `<li>${feature}</li>`).join("")}</ul>${plan.name === "Starter" ? '<a href="/login?signup=1">Start free</a>' : '<a href="/login?signup=1">Create account to choose</a>'}</article>`).join("")}
        </section>
        <p>Yearly Growth is $120 USD and Business is $240 USD (10 monthly payments). When enabled, new accounts receive 30 days of Business without payment details, then return to free Starter with no charge. Paid checkout is a one-time payment; automatic renewal is not set up. Paid features have a 7-day grace period after expiry, and account records are not automatically deleted when a plan expires.</p>
      </main>
    `;
  }
  if (route.path === "/features") {
    return `
      <main class="seo-prerender" aria-label="Verifin features">
        <section><p>Verifin features</p><h1>Keep the work behind every sale clear</h1><p>For grocery shops, hardware stores, boutiques, tuckshops and bakeries.</p><p><a href="/demo">Try the interactive demo</a> · <a href="/login?signup=1">Start free</a></p></section>
        <section><h2>Know what is in stock</h2><p>Track product quantities, spot what is running low, and see how sales change your stock.</p><h2>Record daily sales</h2><p>Record what you sold and keep sale details together with your stock records.</p><h2>Track business expenses</h2><p>Log business spending as it happens and review it alongside sales in your reports.</p><h2>Keep working when data drops</h2><p>Save supported sales, stock updates and expenses on this device. They queue for sync when your connection returns.</p><h2>See how the shop is doing</h2><p>Use clear sales, stock and expense summaries to understand what needs your attention.</p></section>
      </main>
    `;
  }
  const links = routes.filter((page) => page.path !== route.path).map((page) => `<a href="${page.path}">${escapeHtml(page.heading)}</a>`).join(" | ");
  return `
    <main class="seo-prerender" aria-label="${escapeHtml(route.heading)}">
      <section>
        <p>Verifin</p>
        <h1>${escapeHtml(route.heading)}</h1>
        <p>${escapeHtml(route.body)}</p>
        <nav aria-label="Explore Verifin">${links}</nav>
        <p>${escapeHtml(route.cta)}</p>
      </section>
    </main>
  `;
}

function injectRoute(html, route) {
  const canonical = `${SITE_URL}${route.path === "/" ? "/" : route.path}`;
  const description = escapeHtml(route.description);
  const title = escapeHtml(route.title);
  const rendered = staticMarkup(route);
  let next = html;

  next = next.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`);
  next = setTag(next, /<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${description}" />`);
  next = setTag(next, /<meta name="robots" content="[^"]*"\s*\/>/, `<meta name="robots" content="index, follow" />`);
  next = setTag(next, /<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${canonical}" />`);
  next = setTag(next, /<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${title}" />`);
  next = setTag(next, /<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${description}" />`);
  next = setTag(next, /<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${canonical}" />`);
  next = setTag(next, /<meta property="og:image" content="[^"]*"\s*\/>/, `<meta property="og:image" content="${IMAGE_URL}" />`);
  next = setTag(next, /<meta name="twitter:card" content="[^"]*"\s*\/>/, `<meta name="twitter:card" content="summary_large_image" />`);
  next = setTag(next, /<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${title}" />`);
  next = setTag(next, /<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${description}" />`);
  next = setTag(next, /<meta name="twitter:image" content="[^"]*"\s*\/>/, `<meta name="twitter:image" content="${IMAGE_URL}" />`);
  next = next.replace('<div id="root"></div>', `<div id="root">${rendered}</div>`);
  return next;
}

const baseHtml = await readFile(path.join(distDir, "index.html"), "utf8");

for (const route of routes) {
  const html = injectRoute(baseHtml, route);
  const outDir = route.path === "/" ? distDir : path.join(distDir, route.path.slice(1));
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "index.html"), html);
}

const notFoundHtml = baseHtml
  .replace(/<title>.*?<\/title>/s, "<title>Page not found | Verifin</title>")
  .replace(/<meta name="description" content="[^"]*"\s*\/>/, '<meta name="description" content="This Verifin page could not be found. Visit the homepage, explore the product demo, or contact our team." />')
  .replace(/<meta name="robots" content="[^"]*"\s*\/>/, '<meta name="robots" content="noindex, follow" />')
  .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, "")
  .replace('<div id="root"></div>', `<div id="root"><main class="seo-prerender"><section><h1>Page not found</h1><p>The page you are looking for may have moved or no longer exists.</p><nav aria-label="Helpful links"><a href="/">Go to Verifin home</a> | <a href="/demo">Explore the demo</a> | <a href="/pricing">View pricing</a> | <a href="/contact">Contact us</a></nav></section></main></div>`);
await writeFile(path.join(distDir, "404.html"), notFoundHtml);

console.log(`Prerendered ${routes.length} public routes and a custom 404 page.`);
