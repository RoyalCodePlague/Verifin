import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { GoogleSignIn } from "./GoogleSignIn";
import { googleConfigRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({ googleConfigRequest: vi.fn() }));
const initialize = vi.fn();
const renderButton = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  window.google = { accounts: { id: { initialize, renderButton } } };
});
afterEach(() => { cleanup(); delete window.google; });

describe("Google sign-in button", () => {
  it("uses server client ID and nonce and exchanges the returned credential", async () => {
    vi.mocked(googleConfigRequest).mockResolvedValue({ client_id: "web-client", nonce: "signed-nonce" });
    const onCredential = vi.fn().mockResolvedValue(undefined);
    render(<GoogleSignIn onCredential={onCredential} disabled={false} />);
    await waitFor(() => expect(renderButton).toHaveBeenCalled());
    const options = initialize.mock.calls[0][0];
    expect(options).toMatchObject({ client_id: "web-client", nonce: "signed-nonce", auto_select: false });
    await act(async () => options.callback({ credential: "google-token" }));
    expect(onCredential).toHaveBeenCalledWith("google-token", "signed-nonce");
  });
  it("shows email fallback when unconfigured", async () => {
    vi.mocked(googleConfigRequest).mockResolvedValue({ client_id: "", nonce: null });
    render(<GoogleSignIn onCredential={vi.fn()} disabled={false} />);
    expect(await screen.findByText(/not available yet/)).toBeInTheDocument();
    expect(initialize).not.toHaveBeenCalled();
  });
  it("offers retry on configuration failure", async () => {
    vi.mocked(googleConfigRequest).mockRejectedValue(new Error("offline"));
    render(<GoogleSignIn onCredential={vi.fn()} disabled={false} />);
    expect(await screen.findByRole("button", { name: "Retry Google sign-in" })).toBeInTheDocument();
  });
});
