import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SITE_URL = "https://verifin-tau.vercel.app";
const IMAGE_URL = `${SITE_URL}/og-image.png`;
const distDir = path.resolve("dist");

const routes = [
  {
    path: "/",
    title: "Verifin - Smart Inventory & Admin for African SMEs",
    description: "Automate admin, control stock, track sales and expenses, run audits, and work offline with Verifin.",
    heading: "Smart Inventory & Admin for African SMEs",
    body: "Verifin helps African SMEs manage inventory, sales, expenses, audits, reports, customer loyalty, and offline business operations in one practical app.",
    keywords: ["inventory management", "sales tracking", "expense tracking", "stock audits", "offline business app", "African SMEs"],
    cta: "Start free or try the interactive demo.",
  },
  {
    path: "/pricing",
    title: "Verifin Pricing - Inventory and Admin Software for SMEs",
    description: "Compare Verifin plans for African SMEs. Start free, then unlock inventory automation, audits, reports, OCR, and AI assistance.",
    heading: "Verifin Pricing",
    body: "Compare Starter, Growth, and Business plans for inventory management, admin automation, barcode scanning, receipt OCR, reporting, and role-based controls.",
    keywords: ["Verifin pricing", "inventory software pricing", "SME business software plans"],
    cta: "Start free and upgrade when your business needs more power.",
  },
  {
    path: "/demo",
    title: "Verifin Demo - See Inventory, Sales, Audits and Reports",
    description: "Try the Verifin product tour and see how sales, stock, expenses, audits, customer loyalty, and reports work together.",
    heading: "Interactive Verifin Product Tour",
    body: "See how Verifin records sales, updates stock, tracks expenses, runs audits, supports customer loyalty, and turns business activity into reports.",
    keywords: ["inventory app demo", "sales tracking demo", "stock audit demo"],
    cta: "Try the demo and see the workflow in action.",
  },
  {
    path: "/about",
    title: "About Verifin - Business Software Built for African SMEs",
    description: "Learn how Verifin helps African SMEs reduce stock loss, automate admin, and get clearer visibility into their business.",
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
    cta: "Send a message and the team will respond.",
  },
  {
    path: "/help",
    title: "Verifin Help Center - Inventory and Admin Support",
    description: "Find Verifin support articles for inventory, sales, expenses, audits, reports, offline mode, and app installation.",
    heading: "Verifin Help Center",
    body: "Find help for inventory tracking, sales, expenses, stock audits, reports, offline mode, PWA installation, barcode scanning, and AI insights.",
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
  const keywords = route.keywords.map((keyword) => `<li>${escapeHtml(keyword)}</li>`).join("");
  return `
    <main class="seo-prerender" aria-label="${escapeHtml(route.heading)}">
      <section>
        <p>Verifin</p>
        <h1>${escapeHtml(route.heading)}</h1>
        <p>${escapeHtml(route.body)}</p>
        <ul>${keywords}</ul>
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

console.log(`Prerendered ${routes.length} public routes.`);
