import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, RefreshCw, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { decideApprovalRequestApi, listApprovalRequestsApi, type ApiApprovalRequest } from "@/lib/api";

const APPROVER_ROLES: Record<string, string[]> = {
  "sales.void": ["Owner", "Manager"],
  "sales.discount_approve": ["Owner", "Manager", "Administrator", "Branch Manager"],
  "sales.refund": ["Owner", "Manager", "Administrator", "Branch Manager"],
  "inventory.adjust": ["Owner", "Manager", "Administrator", "Stock Manager", "Inventory Manager", "Branch Manager"],
  "suppliers.pay": ["Owner", "Manager", "Administrator"],
  "purchasing.approve": ["Owner", "Manager", "Administrator", "Branch Manager"],
  "till.review": ["Owner", "Manager", "Administrator", "Branch Manager"],
  "financial.adjust": ["Owner", "Manager", "Administrator"],
};

const statusVariant = (status: ApiApprovalRequest["status"]) =>
  status === "approved" || status === "consumed" ? "default" : status === "rejected" || status === "expired" ? "destructive" : "secondary";

export default function Approvals() {
  const { isStaffSession, staffSession } = useAuth();
  const [items, setItems] = useState<ApiApprovalRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<ApiApprovalRequest["status"] | undefined>("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listApprovalRequestsApi(statusFilter));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load approval requests.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const mayReview = (request: ApiApprovalRequest) => {
    if (!isStaffSession) return true;
    if (!staffSession || staffSession.id === request.requested_by_staff) return false;
    return staffSession.permissions.includes("*")
      || staffSession.permissions.includes(request.action)
      || (APPROVER_ROLES[request.action] || []).includes(staffSession.role);
  };

  const decide = async (request: ApiApprovalRequest, decision: "approve" | "reject") => {
    const verb = decision === "approve" ? "approve" : "reject";
    if (!window.confirm(`Are you sure you want to ${verb} request #${request.id} (${request.action_label})?`)) return;
    setBusyId(request.id);
    try {
      await decideApprovalRequestApi(request.id, decision);
      toast.success(`Request #${request.id} ${decision === "approve" ? "approved" : "rejected"}.`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not ${verb} this request.`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">Approval requests</h2>
          <p className="mt-1 text-sm text-muted-foreground">Review protected staff actions. Approved requests must be retried by the requester within 30 minutes.</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter approval requests">
        <Button size="sm" variant={statusFilter === "pending" ? "default" : "outline"} onClick={() => setStatusFilter("pending")}>Pending</Button>
        <Button size="sm" variant={statusFilter === undefined ? "default" : "outline"} onClick={() => setStatusFilter(undefined)}>Recent requests</Button>
      </div>

      {loading ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Loading requests…</CardContent></Card>
      ) : items.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 p-10 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No {statusFilter === "pending" ? "pending " : ""}approval requests</p>
          <p className="text-sm text-muted-foreground">New requests will appear here when staff need review.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {items.map((request) => {
            const canDecide = request.status === "pending" && mayReview(request);
            const requestData = request.payload?.data ?? request.payload;
            return (
              <Card key={request.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{request.action_label} <span className="text-muted-foreground">· #{request.id}</span></CardTitle>
                    <p className="text-sm text-muted-foreground">{request.summary}</p>
                  </div>
                  <Badge variant={statusVariant(request.status)}>{request.status}</Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                    <span>Requested by {request.requester_name}</span>
                    {request.branch_name && <span>Branch: {request.branch_name}</span>}
                    <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{new Date(request.created_at).toLocaleString()}</span>
                    {request.status === "approved" && <span>Retry before {new Date(request.expires_at).toLocaleTimeString()}</span>}
                    {request.decided_by_staff_name && <span>Reviewed by {request.decided_by_staff_name}</span>}
                  </div>
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">Review operation details</summary>
                    <div className="mt-2 space-y-2">
                      <p className="break-all text-xs text-muted-foreground">{request.payload?.request?.method} {request.payload?.request?.path}</p>
                      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(requestData, null, 2)}</pre>
                    </div>
                  </details>
                  {request.decision_note && <p className="text-sm text-muted-foreground">Reviewer note: {request.decision_note}</p>}
                  {canDecide ? (
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void decide(request, "approve")} disabled={busyId === request.id}>
                        <Check className="h-4 w-4" /> Approve
                      </Button>
                      <Button variant="destructive" onClick={() => void decide(request, "reject")} disabled={busyId === request.id}>
                        <X className="h-4 w-4" /> Reject
                      </Button>
                    </div>
                  ) : request.status === "pending" && isStaffSession ? (
                    <p className="text-xs text-muted-foreground">You can view this request, but only an authorized reviewer from its branch can decide it.</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
