import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, UserCog, Search } from "lucide-react";
import { useStore } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { EmptyState } from "@/components/ui/empty-state";

const Staff = () => {
  const { staff, addStaff, updateStaff, deleteStaff } = useStore();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", role: "Cashier" as "Cashier" | "Stock Manager" | "Manager" });

  const filtered = staff.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.role.toLowerCase().includes(search.toLowerCase()));

  const handleAdd = () => {
    addStaff({ name: form.name, role: form.role, status: "Active", lastActive: "Just added" });
    setForm({ name: "", role: "Cashier" });
    setAddOpen(false);
  };

  const toggleStatus = (id: string, current: string) => {
    updateStaff(id, { status: current === "Active" ? "Inactive" : "Active" });
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
        <EmptyState icon={UserCog} title="No team members found" description={search ? "Try a different search" : "Add your staff to track roles and active team members"} actionLabel="Add Staff" onAction={() => setAddOpen(true)} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {filtered.map((s) => (
            <Card key={s.id} className="shadow-soft group">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-display font-bold text-sm text-primary">
                  {s.name.split(" ").map(n => n[0]).join("")}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.role} · {s.lastActive}</p>
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display">Add Staff Member</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Full Name</Label><Input placeholder="e.g. Grace Chikumba" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1" /></div>
            <div>
              <Label>Role</Label>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as "Cashier" | "Stock Manager" | "Manager" })} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="Cashier">Cashier</option>
                <option value="Stock Manager">Stock Manager</option>
                <option value="Manager">Manager</option>
              </select>
            </div>
            <Button onClick={handleAdd} disabled={!form.name.trim()} className="w-full bg-gradient-hero text-primary-foreground">Add Staff</Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmationModal open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Remove Staff" description="Remove this team member?" confirmLabel="Remove" variant="destructive" onConfirm={() => { if (deleteId) deleteStaff(deleteId); setDeleteId(null); }} />
    </div>
  );
};

export default Staff;
