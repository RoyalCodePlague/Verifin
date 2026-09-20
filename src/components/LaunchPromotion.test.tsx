import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { LaunchPromotion } from "./LaunchPromotion";

vi.mock("@/lib/api", () => ({ getPricingContextApi: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(() => "signup-business-promotion"), dismiss: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function show(enabled: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["pricing-context"], { launch_promotion: { enabled, days: 30 } });
  return render(<QueryClientProvider client={client}><LaunchPromotion /></QueryClientProvider>);
}

describe("signup promotion notification", () => {
  it("announces the Business plan and Starter transition without a banner", () => {
    const { container, unmount } = show(true);
    expect(container).toBeEmptyDOMElement();
    expect(toast.info).toHaveBeenCalledWith("Get 30 days of the Business plan free", expect.objectContaining({
      description: "Your Business plan starts when you sign up. After 30 days, your account moves to the free Starter plan.",
      closeButton: true,
    }));
    unmount();
    expect(toast.dismiss).toHaveBeenCalledWith("signup-business-promotion");
  });
  it("does not announce an offer disabled by the server", () => {
    show(false);
    expect(toast.info).not.toHaveBeenCalled();
  });
});
