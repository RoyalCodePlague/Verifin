import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { RouteSEO } from "./RouteSEO";

afterEach(cleanup);

describe("route search metadata", () => {
  it("uses the production domain and excludes query strings from canonical URLs", async () => {
    render(<MemoryRouter initialEntries={["/pricing/?utm_source=test"]}><RouteSEO /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://verifin.co.zw/pricing"));
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
    expect(document.title).toContain("Pricing");
  });

  it.each(["/verify-email?token=private", "/dashboard", "/inventory", "/does-not-exist"])("keeps %s out of search results", async (route) => {
    render(<MemoryRouter initialEntries={[route]}><RouteSEO /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow"));
  });
});
