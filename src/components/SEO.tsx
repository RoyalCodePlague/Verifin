import { useEffect } from "react";

const SITE_URL = "https://verifin-tau.vercel.app";
const DEFAULT_IMAGE = `${SITE_URL}/og-image.png`;

type SEOProps = {
  title: string;
  description: string;
  path?: string;
  noindex?: boolean;
  type?: "website" | "article";
};

function upsertMeta(selector: string, attr: "content" | "href", value: string, create: () => HTMLElement) {
  let element = document.head.querySelector(selector) as HTMLElement | null;
  if (!element) {
    element = create();
    document.head.appendChild(element);
  }
  element.setAttribute(attr, value);
}

export function SEO({ title, description, path = "/", noindex = false, type = "website" }: SEOProps) {
  useEffect(() => {
    const canonical = `${SITE_URL}${path}`;
    document.title = title;

    upsertMeta('meta[name="description"]', "content", description, () => {
      const meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      return meta;
    });

    upsertMeta('meta[name="robots"]', "content", noindex ? "noindex, nofollow" : "index, follow", () => {
      const meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      return meta;
    });

    upsertMeta('link[rel="canonical"]', "href", canonical, () => {
      const link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      return link;
    });

    const ogTags: Record<string, string> = {
      "og:title": title,
      "og:description": description,
      "og:type": type,
      "og:url": canonical,
      "og:image": DEFAULT_IMAGE,
      "og:site_name": "Verifin",
    };

    Object.entries(ogTags).forEach(([property, content]) => {
      upsertMeta(`meta[property="${property}"]`, "content", content, () => {
        const meta = document.createElement("meta");
        meta.setAttribute("property", property);
        return meta;
      });
    });

    const twitterTags: Record<string, string> = {
      "twitter:card": "summary_large_image",
      "twitter:title": title,
      "twitter:description": description,
      "twitter:image": DEFAULT_IMAGE,
    };

    Object.entries(twitterTags).forEach(([name, content]) => {
      upsertMeta(`meta[name="${name}"]`, "content", content, () => {
        const meta = document.createElement("meta");
        meta.setAttribute("name", name);
        return meta;
      });
    });
  }, [description, noindex, path, title, type]);

  return null;
}
