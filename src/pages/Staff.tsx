import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, BadgeCheck, Copy, Eye, EyeOff, Plus, Search, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { useStore, type StaffMember } from "@/lib/store";
import { ROLE_DEFAULT_PERMISSIONS, useAuth } from "@/lib/auth-context";
import { createStaffApi, deleteStaffApi, getApprovalSettingsApi, listStaffActivityLogsApi, updateApprovalSettingsApi, updateStaffApi, type ApiApprovalSettings, type ApiStaff, type ApiStaffActivityLog } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { addToOfflineQueue, canQueueOfflineAction, hasQueuedLocalCreate, removeQueuedLocalCreate } from "@/lib/offlineQueue";
import { toast } from "sonner";
import { LockedBadge, useFeatureAccess, useUpgradePrompt } from "@/lib/features";

type StaffRole = Exclude<StaffMember["role"], "Owner">;

const permissionOptions = [
  { id: "dashboard", label: "Dashboard" },
  { id: "sales", label: "Sales" },
  { id: "inventory", label: "Inventory" },
  { id: "expenses", label: "Expenses" },
  { id: "customers", label: "Customers" },
  { id: "reports", label: "Reports" },
  { id: "audits", label: "Audits" },
  { id: "suppliers", label: "Suppliers" },
  { id: "staff", label: "Staff" },
  { id: "settings", label: "Settings" },
  { id: "billing", label: "Billing" },
  { id: "financial", label: "Financial accounts" },
];

const sensitivePermissionOptions = [
  { id: "sales.void", label: "Void completed sales" },
  { id: "sales.discount_approve", label: "Approve large discounts" },
  { id: "sales.refund", label: "Process refunds" },
  { id: "inventory.adjust", label: "Adjust stock" },
  { id: "suppliers.pay", label: "Record supplier payments" },
  { id: "purchasing.approve", label: "Approve purchase orders" },
  { id: "till.review", label: "Review till sessions" },
  { id: "financial.adjust", label: "Post financial adjustments" },
];

const roleDefaults = {
  Administrator: ROLE_DEFAULT_PERMISSIONS.Administrator,
  "Branch Manager": ROLE_DEFAULT_PERMISSIONS["Branch Manager"],
  Cashier: ROLE_DEFAULT_PERMISSIONS.Cashier,
  Salesperson: ROLE_DEFAULT_PERMISSIONS.Salesperson,
  "Stock Manager": ROLE_DEFAULT_PERMISSIONS["Stock Manager"],
  "Inventory Manager": ROLE_DEFAULT_PERMISSIONS["Inventory Manager"],
  Accountant: ROLE_DEFAULT_PERMISSIONS.Accountant,
  Custom: ROLE_DEFAULT_PERMISSIONS.Custom,
  Manager: ROLE_DEFAULT_PERMISSIONS.Manager,
} satisfies Record<StaffRole, string[]>;

const emptyForm = {
  name: "",
  role: "Cashier" as StaffRole,
  branchId: "",
  username: "",
  tempPassword: "",
  loginEnabled: true,
  permissions: roleDefaults.Cashier,
};

function maskPassword(password?: string) {
  return password ? "•".repeat(Math.max(8, password.length)) : "Password hidden after sync";
}

function fromApiStaff(staff: ApiStaff): StaffMember {
  return {
    id: String(staff.id),
    name: staff.name,
    role: staff.role,
    status: staff.status,
    lastActive: staff.last_active ? new Date(staff.last_active).toLocaleDateString() : "Just added",
    branchId: staff.branch ? String(staff.branch) : undefined,
    branchName: staff.branch_name || "",
    username: staff.username || "",
    permissions: staff.permissions || [],
    loginEnabled: staff.login_enabled ?? false,
  };
}

const Staff = () => {
  const { staff, branches, addStaff, upsertStaff, updateStaff, deleteStaff } = useStore();
  const { user, isStaffSession } = useAuth();
  const { canUse } = useFeatureAccess();
  const promptUpgrade = useUpgradePrompt();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [showStaffPassword, setShowStaffPassword] = useState(false);
  const [activityLogs, setActivityLogs] = useState<ApiStaffActivityLog[]>([]);
  const [activityAction, setActivityAction] = useState("");
  const [activityObject, setActivityObject] = useState("");
  const [activityFrom, setActivityFrom] = useState("");
  const [activityTo, setActivityTo] = useState("");
  const [activitySearch, setActivitySearch] = useState("");
  const [editingRole, setEditingRole] = useState<StaffRole>("Cashier");
  const [editingPermissions, setEditingPermissions] = useState<string[]>([]);
  const [approvalSettings, setApprovalSettings] = useState<ApiApprovalSettings | null>(null);
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void listStaffActivityLogsApi()
      .then((logs) => {
        if (!cancelled) setActivityLogs(logs);
      })
      .catch(() => {
        if (!cancelled) setActivityLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getApprovalSettingsApi()
      .then((settings) => { if (!cancelled) setApprovalSettings(settings); })
      .catch(() => { if (!cancelled) setApprovalSettings(null); })
      .finally(() => { if (!cancelled) setApprovalLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = staff.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.role.toLowerCase().includes(search.toLowerCase()) ||
    (s.username || "").toLowerCase().includes(search.toLowerCase())
  );
  const selectedStaff = staff.find((member) => member.id === detailsId) || null;
  const businessCode = user?.business_code || "";
  const filteredActivityLogs = activityLogs.filter(log => {
    const actor = log.staff_actor_name || log.actor_name || log.actor_email || "system";
    const term = activitySearch.trim().toLowerCase();
    const matchesSearch = !term || `${actor} ${log.action} ${log.object_type} ${log.object_id} ${log.summary}`.toLowerCase().includes(term);
    return matchesSearch && (!activityAction || log.action === activityAction) && (!activityObject || log.object_type === activityObject) && (!activityFrom || log.created_at.slice(0,10) >= activityFrom) && (!activityTo || log.created_at.slice(0,10) <= activityTo);
  });
  const exportActivity = () => {
    if (!canUse("staff_activity_logs")) { promptUpgrade("staff_activity_logs", "Activity Logs"); return; }
    const csv = ["Action,Object,ID,Summary,Actor,Date", ...filteredActivityLogs.map(log => [log.action,log.object_type,log.object_id,log.summary,log.staff_actor_name || log.actor_name || log.actor_email || "system",log.created_at].map(value => `"${String(value ?? "").replace(/"/g,'""')}"`).join(","))].join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"})); link.download = "staff-activity.csv"; link.click(); URL.revokeObjectURL(link.href);
  };

  const copyBusinessCode = async () => {
    if (!businessCode) return;
    try {
      await navigator.clipboard.writeText(businessCode);
      toast.success("Business code copied.");
    } catch {
      toast.error("Could not copy business code.");
    }
  };

  const resetForm = () => setForm({ ...emptyForm, permissions: [...emptyForm.permissions] });

  const handleRoleChange = (role: StaffRole) => {
    setForm({ ...form, role, permissions: [...roleDefaults[role]] });
  };

  const openStaffDetails = (member: StaffMember) => {
    setDetailsId(member.id);
    setShowStaffPassword(false);
    setEditingRole((member.role === "Owner" ? "Manager" : member.role) as StaffRole);
    setEditingPermissions([...(member.permissions?.length ? member.permissions : roleDefaults[member.role as StaffRole] || [])]);
  };

  const saveStaffAccess = async () => {
    if (!selectedStaff) return;
    if (!/^\d+$/.test(selectedStaff.id)) {
      toast.error("Sync this staff member before changing access.");
      return;
    }
    setSaving(true);
    try {
      const saved = await updateStaffApi(selectedStaff.id, { role: editingRole, permissions: editingPermissions });
      upsertStaff({ ...fromApiStaff(saved), tempPassword: selectedStaff.tempPassword });
      toast.success("Staff role and permissions updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update staff access.");
    } finally {
      setSaving(false);
    }
  };

  const toggleEditingPermission = (permission: string) => {
    if (!canUse("role_based_access")) {
      promptUpgrade("role_based_access", "Custom role permissions");
      return;
    }
    setEditingPermissions((current) => current.includes(permission)
      ? current.filter((item) => item !== permission)
      : [...current, permission]);
  };

  const saveApprovalSettings = async () => {
    if (!approvalSettings) return;
    setApprovalSaving(true);
    try {
      const saved = await updateApprovalSettingsApi(approvalSettings);
      setApprovalSettings(saved);
      toast.success("Approval thresholds updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update approval thresholds.");
    } finally {
      setApprovalSaving(false);
    }
  };

  const togglePermission = (permission: string) => {
    const permissions = form.permissions.includes(permission)
      ? form.permissions.filter((item) => item !== permission)
      : [...form.permissions, permission];
    setForm({ ...form, permissions });
  };

  const handleAdd = async () => {
    const payload = {
      name: form.name.trim(),
      role: form.role,
      branch: form.branchId ? Number(form.branchId) : null,
      status: "Active" as const,
      username: form.username.trim().toLowerCase(),
      temp_password: form.tempPassword,
      permissions: form.permissions,
      login_enabled: form.loginEnabled,
    };
    if (!payload.name || !payload.username || !payload.temp_password) return;

    setSaving(true);
    try {
      if (navigator.onLine) {
        const created = await createStaffApi(payload);
        upsertStaff({ ...fromApiStaff(created), tempPassword: payload.temp_password });
      } else {
        const localId = addStaff({
          name: payload.name,
          role: payload.role,
          status: payload.status,
          lastActive: "Just added",
          branchId: form.branchId || undefined,
          branchName: branches.find((branch) => branch.id === form.branchId)?.name || "",
          username: payload.username,
          tempPassword: payload.temp_password,
          permissions: payload.permissions,
          loginEnabled: payload.login_enabled,
        });
        if (canQueueOfflineAction()) {
          addToOfflineQueue({ type: "staff_create", payload: { local_id: localId, ...payload } });
        }
      }
      toast.success("Staff login created.");
      resetForm();
      setAddOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add staff member");
    } finally {
      setSaving(false);
    }
  };

  const assignBranch = async (member: StaffMember, branchId: string) => {
    if (!canUse("multi_branch")) {
      promptUpgrade("multi_branch", "Staff branch assignment");
      return;
    }
    const branch = branches.find((item) => item.id === branchId);
    updateStaff(member.id, { branchId: branchId || undefined, branchName: branch?.name || "" });
    try {
      if (!/^\d+$/.test(member.id)) {
        throw new Error("Sync this staff member before changing their branch.");
      }
      const saved = await updateStaffApi(member.id, { branch: branchId ? Number(branchId) : null });
      upsertStaff({ ...fromApiStaff(saved), tempPassword: member.tempPassword });
      toast.success("Staff branch updated.");
    } catch (error) {
      updateStaff(member.id, { branchId: member.branchId, branchName: member.branchName });
      toast.error(error instanceof Error ? error.message : "Could not update staff branch.");
    }
  };

  const toggleStatus = async (id: string, current: string) => {
    const status = current === "Active" ? "Inactive" : "Active";
    updateStaff(id, { status, loginEnabled: status === "Active" });
    try {
      if (navigator.onLine && /^\d+$/.test(id)) {
        await updateStaffApi(id, { status, login_enabled: status === "Active" });
      } else if (canQueueOfflineAction() && /^\d+$/.test(id)) {
        addToOfflineQueue({ type: "staff_update", payload: { id: Number(id), status, login_enabled: status === "Active" } });
      }
    } catch (error) {
      updateStaff(id, { status: current as StaffMember["status"], loginEnabled: current === "Active" });
      toast.error(error instanceof Error ? error.message : "Could not update staff status");
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const id = deleteId;
    deleteStaff(id);
    setDeleteId(null);
    try {
      if (navigator.onLine && /^\d+$/.test(id)) {
        await deleteStaffApi(id);
      } else if (canQueueOfflineAction()) {
        if (hasQueuedLocalCreate("staff_create", id)) removeQueuedLocalCreate("staff_create", id);
        else if (/^\d+$/.test(id)) addToOfflineQueue({ type: "staff_delete", payload: { id: Number(id) } });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove staff member");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-soft border-primary/15">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BadgeCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium">Business Code</p>
              <p className="text-xs text-muted-foreground">Give this to staff with their username and password.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm font-semibold">
              {businessCode || "Loading..."}
            </div>
            <Button type="button" variant="outline" size="icon" onClick={() => void copyBusinessCode()} disabled={!businessCode} title="Copy business code">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {!isStaffSession && <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" /> Approval Thresholds</CardTitle>
          <p className="text-xs text-muted-foreground">Above these limits, an authorized approver must perform the action. Amounts use {user?.currency || "your base currency"}. Leave a field blank to disable that threshold.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {approvalLoading ? <p className="text-sm text-muted-foreground">Loading approval settings…</p> : approvalSettings ? <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="grid gap-1 text-xs"><span>Discount rate (%)</span><Input type="number" min="0" max="100" step="0.01" value={approvalSettings.discount_percent_threshold ?? ""} onChange={(event) => setApprovalSettings({...approvalSettings, discount_percent_threshold: event.target.value === "" ? null : event.target.value})} /></label>
              <label className="grid gap-1 text-xs"><span>Refund amount ({user?.currency || "base currency"})</span><Input type="number" min="0" step="0.01" value={approvalSettings.refund_amount_base_threshold ?? ""} onChange={(event) => setApprovalSettings({...approvalSettings, refund_amount_base_threshold: event.target.value === "" ? null : event.target.value})} /></label>
              <label className="grid gap-1 text-xs"><span>Stock adjustment (units)</span><Input type="number" min="0" step="1" value={approvalSettings.stock_adjustment_units_threshold ?? ""} onChange={(event) => setApprovalSettings({...approvalSettings, stock_adjustment_units_threshold: event.target.value === "" ? null : Number(event.target.value)})} /></label>
              <label className="grid gap-1 text-xs"><span>Supplier payment ({user?.currency || "base currency"})</span><Input type="number" min="0" step="0.01" value={approvalSettings.supplier_payment_amount_base_threshold ?? ""} onChange={(event) => setApprovalSettings({...approvalSettings, supplier_payment_amount_base_threshold: event.target.value === "" ? null : event.target.value})} /></label>
              <label className="grid gap-1 text-xs"><span>Purchase order ({user?.currency || "base currency"})</span><Input type="number" min="0" step="0.01" value={approvalSettings.purchase_order_amount_base_threshold ?? ""} onChange={(event) => setApprovalSettings({...approvalSettings, purchase_order_amount_base_threshold: event.target.value === "" ? null : event.target.value})} /></label>
            </div>
            <p className="text-xs text-muted-foreground">Purchase orders still follow the submit and approve lifecycle. These settings determine when approval must come from an authorized manager.</p>
            <Button onClick={() => void saveApprovalSettings()} disabled={approvalSaving}>{approvalSaving ? "Saving…" : "Save approval thresholds"}</Button>
          </> : <p className="text-sm text-destructive">Approval settings could not be loaded. Refresh this page to try again.</p>}
        </CardContent>
      </Card>}

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Activity Logs {!canUse("staff_activity_logs") && <LockedBadge />}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6"><Input aria-label="Search activity logs" placeholder="Search actor or record" value={activitySearch} onChange={e=>setActivitySearch(e.target.value)} /><select aria-label="Activity type" className="h-9 rounded-md border bg-background px-2 text-xs" value={activityAction} onChange={e=>setActivityAction(e.target.value)}><option value="">All actions</option>{[...new Set(activityLogs.map(log=>log.action))].map(action=><option key={action} value={action}>{action.replace(/_/g," ")}</option>)}</select><select aria-label="Object type" className="h-9 rounded-md border bg-background px-2 text-xs" value={activityObject} onChange={e=>setActivityObject(e.target.value)}><option value="">All objects</option>{[...new Set(activityLogs.map(log=>log.object_type).filter(Boolean))].map(object=><option key={object} value={object}>{object}</option>)}</select><Input aria-label="From date" type="date" value={activityFrom} onChange={e=>setActivityFrom(e.target.value)} /><Input aria-label="To date" type="date" value={activityTo} onChange={e=>setActivityTo(e.target.value)} /><Button variant="outline" onClick={exportActivity}>Export CSV</Button></div>
          {filteredActivityLogs.length ? filteredActivityLogs.map((log) => (
            <div key={log.id} className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">{log.summary}</p>
                <p className="text-xs text-muted-foreground">{log.action.replace(/_/g, " ")} · {log.staff_actor_name || log.actor_name || log.actor_email || "system"}</p>
                <details className="mt-1 text-[11px] text-muted-foreground"><summary className="cursor-pointer">Record details</summary><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap">{JSON.stringify(log.metadata, null, 2)}</pre></details>
              </div>
              <p className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</p>
            </div>
          )) : (
            <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              Staff activity will appear here as your team creates products, suppliers, purchase orders, API keys, and customer collection records.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={() => setAddOpen(true)} className="bg-gradient-hero text-primary-foreground"><Plus className="h-4 w-4 mr-2" /> Add Staff</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={UserCog} title="No team members found" description={search ? "Try a different search" : "Add staff logins and choose what each role can access"} actionLabel="Add Staff" onAction={() => setAddOpen(true)} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {filtered.map((s) => (
            <Card
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => openStaffDetails(s)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openStaffDetails(s);
                }
              }}
              className="shadow-soft group cursor-pointer transition-shadow hover:shadow-card"
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-display font-bold text-sm text-primary">
                  {s.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {s.role} · {s.username || "No login"} · {s.lastActive}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(s.permissions || roleDefaults[s.role as StaffRole] || []).slice(0, 4).map((permission) => (
                      <Badge key={permission} variant="outline" className="text-[10px] px-1.5 py-0">
                        {permission}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={(event) => { event.stopPropagation(); void toggleStatus(s.id, s.status); }}>
                    <Badge className={s.status === "Active" ? "bg-success/10 text-success hover:bg-success/20 cursor-pointer" : "bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer"}>
                      {s.status}
                    </Badge>
                  </button>
                  {s.role !== "Owner" && (
                    <button onClick={(event) => { event.stopPropagation(); setDeleteId(s.id); }} className="p-1.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display">Add Staff Login</DialogTitle>
            <DialogDescription>Create a username, password, role, and access list for this staff member.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Full Name</Label><Input placeholder="e.g. Grace Chikumba" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1" /></div>
              <div>
                <Label>Role</Label>
                <select value={form.role} onChange={e => handleRoleChange(e.target.value as StaffRole)} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="Administrator">Administrator</option>
                  <option value="Branch Manager">Branch Manager</option>
                  <option value="Cashier">Cashier</option>
                  <option value="Salesperson">Salesperson</option>
                  <option value="Stock Manager">Stock Manager</option>
                  <option value="Inventory Manager">Inventory Manager</option>
                  <option value="Accountant">Accountant</option>
                  <option value="Custom">Custom</option>
                  <option value="Manager">Manager</option>
                </select>
              </div>
              {canUse("multi_branch") && branches.length > 0 ? (
                <div>
                  <Label>Branch</Label>
                  <select value={form.branchId} onChange={e => setForm({ ...form, branchId: e.target.value })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">No branch assigned</option>
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </div>
              ) : null}
              <div><Label>Username</Label><Input placeholder="cashier01" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} className="mt-1" /></div>
              <div><Label>Temporary Password</Label><Input type="password" placeholder="At least 4 characters" value={form.tempPassword} onChange={e => setForm({ ...form, tempPassword: e.target.value })} className="mt-1" minLength={4} /></div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Access {!canUse("role_based_access") && <LockedBadge label="Plan defaults" />}
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={form.loginEnabled} onChange={e => setForm({ ...form, loginEnabled: e.target.checked })} />
                  Login enabled
                </label>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {permissionOptions.map((permission) => (
                  <label key={permission.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-xs">
                    <input type="checkbox" checked={form.permissions.includes(permission.id)} onChange={() => {if(!canUse("role_based_access")){promptUpgrade("role_based_access","Custom role permissions");return;}togglePermission(permission.id);}} />
                    <span>{permission.label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-xs font-medium">Sensitive operations</p>
                <div className="grid grid-cols-2 gap-2">
                  {sensitivePermissionOptions.map((permission) => (
                    <label key={permission.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-xs">
                      <input type="checkbox" checked={form.permissions.includes(permission.id)} onChange={() => {if(!canUse("role_based_access")){promptUpgrade("role_based_access","Sensitive operation permissions");return;}togglePermission(permission.id);}} />
                      <span>{permission.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <Button onClick={handleAdd} disabled={saving || !form.name.trim() || !form.username.trim() || form.tempPassword.length < 4} className="w-full bg-gradient-hero text-primary-foreground">
              {saving ? "Saving..." : "Create Staff Login"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!selectedStaff} onOpenChange={(open) => { if (!open) { setDetailsId(null); setShowStaffPassword(false); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Staff Details</DialogTitle>
            <DialogDescription>View login details, account status, and access permissions.</DialogDescription>
          </DialogHeader>
          {selectedStaff && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center font-display font-bold text-primary">
                  {selectedStaff.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{selectedStaff.name}</p>
                  <p className="text-sm text-muted-foreground">{editingRole}</p>
                </div>
                <Badge className={selectedStaff.status === "Active" ? "ml-auto bg-success/10 text-success" : "ml-auto bg-muted text-muted-foreground"}>
                  {selectedStaff.status}
                </Badge>
              </div>

              <div className="grid gap-3 rounded-lg border border-border p-3 text-sm">
                {selectedStaff.role === "Owner" ? (
                  <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Role</span><span className="font-medium">Owner</span></div>
                ) : (
                  <label className="grid gap-1">
                    <span className="text-muted-foreground">Role</span>
                    <select value={editingRole} onChange={(event) => {const role=event.target.value as StaffRole;setEditingRole(role);setEditingPermissions([...roleDefaults[role]]);}} className="h-9 rounded-md border border-input bg-background px-3">
                      {Object.keys(roleDefaults).map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </label>
                )}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Username</span>
                  <span className="font-medium">{selectedStaff.username || "Not set"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Login</span>
                  <span className="font-medium">{selectedStaff.loginEnabled ? "Enabled" : "Disabled"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Last active</span>
                  <span className="font-medium">{selectedStaff.lastActive || "Not yet"}</span>
                </div>
                {canUse("multi_branch") && branches.length > 0 ? (
                  <label className="grid gap-1">
                    <span className="text-muted-foreground">Branch</span>
                    <select value={selectedStaff.branchId || ""} onChange={(event) => void assignBranch(selectedStaff, event.target.value)} className="h-9 rounded-md border border-input bg-background px-3">
                      <option value="">No branch assigned</option>
                      {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                    </select>
                  </label>
                ) : null}
                <div>
                  <div className="mb-1 text-muted-foreground">Password</div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 flex-1 items-center rounded-md border border-input bg-background px-3 text-sm font-medium">
                      <span className={selectedStaff.tempPassword ? "font-mono" : "text-muted-foreground"}>
                        {showStaffPassword && selectedStaff.tempPassword ? selectedStaff.tempPassword : maskPassword(selectedStaff.tempPassword)}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setShowStaffPassword(prev => !prev)}
                      disabled={!selectedStaff.tempPassword}
                      title={showStaffPassword ? "Hide password" : "Show password"}
                    >
                      {showStaffPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Access
                </div>
                {selectedStaff.role === "Owner" ? <Badge variant="outline">All permissions</Badge> : (
                  <div className="grid grid-cols-2 gap-2">
                    {[...permissionOptions, ...sensitivePermissionOptions].map((permission) => (
                      <label key={permission.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-xs">
                        <input type="checkbox" checked={editingPermissions.includes(permission.id)} onChange={() => toggleEditingPermission(permission.id)} />
                        <span>{permission.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {selectedStaff.role !== "Owner" && <Button onClick={() => void saveStaffAccess()} disabled={saving}>{saving ? "Saving..." : "Save access"}</Button>}
                <Button variant="outline" onClick={() => void toggleStatus(selectedStaff.id, selectedStaff.status)}>
                  {selectedStaff.status === "Active" ? "Disable Login" : "Enable Login"}
                </Button>
                {selectedStaff.role !== "Owner" && (
                  <Button variant="destructive" onClick={() => { setDeleteId(selectedStaff.id); setDetailsId(null); }}>
                    Remove Staff
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmationModal open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Remove Staff" description="Remove this staff login?" confirmLabel="Remove" variant="destructive" onConfirm={() => void confirmDelete()} />
    </div>
  );
};

export default Staff;
