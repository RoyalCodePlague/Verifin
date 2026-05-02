import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Search, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { useStore, type StaffMember } from "@/lib/store";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/auth-context";
import { createStaffApi, deleteStaffApi, updateStaffApi, type ApiStaff } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { addToOfflineQueue, canQueueOfflineAction, hasQueuedLocalCreate, removeQueuedLocalCreate } from "@/lib/offlineQueue";
import { toast } from "sonner";

type StaffRole = "Cashier" | "Stock Manager" | "Manager";

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
];

const roleDefaults = {
  Cashier: ROLE_DEFAULT_PERMISSIONS.Cashier,
  "Stock Manager": ROLE_DEFAULT_PERMISSIONS["Stock Manager"],
  Manager: ROLE_DEFAULT_PERMISSIONS.Manager,
} satisfies Record<StaffRole, string[]>;

const emptyForm = {
  name: "",
  role: "Cashier" as StaffRole,
  username: "",
  tempPassword: "",
  loginEnabled: true,
  permissions: roleDefaults.Cashier,
};

function fromApiStaff(staff: ApiStaff): StaffMember {
  return {
    id: String(staff.id),
    name: staff.name,
    role: staff.role,
    status: staff.status,
    lastActive: staff.last_active ? new Date(staff.last_active).toLocaleDateString() : "Just added",
    username: staff.username || "",
    permissions: staff.permissions || [],
    loginEnabled: staff.login_enabled ?? false,
  };
}

const Staff = () => {
  const { staff, addStaff, upsertStaff, updateStaff, deleteStaff } = useStore();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const filtered = staff.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.role.toLowerCase().includes(search.toLowerCase()) ||
    (s.username || "").toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => setForm({ ...emptyForm, permissions: [...emptyForm.permissions] });

  const handleRoleChange = (role: StaffRole) => {
    setForm({ ...form, role, permissions: [...roleDefaults[role]] });
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
        upsertStaff(fromApiStaff(created));
      } else {
        const localId = addStaff({
          name: payload.name,
          role: payload.role,
          status: payload.status,
          lastActive: "Just added",
          username: payload.username,
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
            <Card key={s.id} className="shadow-soft group">
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
                  <button onClick={() => toggleStatus(s.id, s.status)}>
                    <Badge className={s.status === "Active" ? "bg-success/10 text-success hover:bg-success/20 cursor-pointer" : "bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer"}>
                      {s.status}
                    </Badge>
                  </button>
                  {s.role !== "Owner" && (
                    <button onClick={() => setDeleteId(s.id)} className="p-1.5 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-xl">
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
                  <option value="Cashier">Cashier</option>
                  <option value="Stock Manager">Stock Manager</option>
                  <option value="Manager">Manager</option>
                </select>
              </div>
              <div><Label>Username</Label><Input placeholder="cashier01" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} className="mt-1" /></div>
              <div><Label>Temporary Password</Label><Input type="password" placeholder="At least 4 characters" value={form.tempPassword} onChange={e => setForm({ ...form, tempPassword: e.target.value })} className="mt-1" minLength={4} /></div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Access
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={form.loginEnabled} onChange={e => setForm({ ...form, loginEnabled: e.target.checked })} />
                  Login enabled
                </label>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {permissionOptions.map((permission) => (
                  <label key={permission.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-xs">
                    <input type="checkbox" checked={form.permissions.includes(permission.id)} onChange={() => togglePermission(permission.id)} />
                    <span>{permission.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <Button onClick={handleAdd} disabled={saving || !form.name.trim() || !form.username.trim() || form.tempPassword.length < 4} className="w-full bg-gradient-hero text-primary-foreground">
              {saving ? "Saving..." : "Create Staff Login"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmationModal open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Remove Staff" description="Remove this staff login?" confirmLabel="Remove" variant="destructive" onConfirm={() => void confirmDelete()} />
    </div>
  );
};

export default Staff;
