import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LaunchPromotion } from "./LaunchPromotion";

vi.mock("@/lib/api", () => ({ getPricingContextApi: vi.fn() }));
afterEach(cleanup);

function show(enabled: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["pricing-context"], { launch_promotion: { enabled, days: 30 } });
  return render(<QueryClientProvider client={client}><LaunchPromotion /></QueryClientProvider>);
}

describe("launch promotion disclosure", () => {
  it("explains duration, automatic downgrade and no automatic charge", () => {
    show(true);
    expect(screen.getByRole("note")).toHaveTextContent("30 days of premium free");
    expect(screen.getByRole("note")).toHaveTextContent("automatically moves to the free Starter plan");
    expect(screen.getByRole("note")).toHaveTextContent("requires a paid upgrade");
    expect(screen.getByRole("note")).toHaveTextContent("No automatic charges");
  });
  it("does not advertise an offer disabled by the server", () => {
    show(false);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
