import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { Building2, GitPullRequest, Moon, Sun } from "lucide-react";
import { createBranchApi, deleteBranchApi, listSyncConflicts, patchMe, resolveSyncConflict, updateBranchApi, type ApiSyncConflict } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useNavigate } from "react-router-dom";

const currencyOptions = [
  { code: "ZAR", symbol: "R", label: "South African Rand (R)" },
  { code: "USD", symbol: "$", label: "US Dollar ($)" },
  { code: "ZWL", symbol: "ZWL", label: "Zimbabwean Dollar (ZWL)" },
  { code: "KES", symbol: "KSh", label: "Kenyan Shilling (KSh)" },
  { code: "NGN", symbol: "₦", label: "Nigerian Naira (₦)" },
  { code: "GHS", symbol: "GH₵", label: "Ghanaian Cedi (GH₵)" },
  { code: "BWP", symbol: "P", label: "Botswana Pula (P)" },
  { code: "EUR", symbol: "€", label: "Euro (€)" },
  { code: "GBP", symbol: "£", label: "British Pound (£)" },
];

const SettingsPage = () => {
  const { profile, branches, setProfile, addBranch, updateBranch, deleteBranch } = useStore();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(profile.name);
  const [currency, setCurrency] = useState(profile.currency);
  const [saving, setSaving] = useState(false);
  const [branchForm, setBranchForm] = useState({ name: "", code: "", phone: "", address: "" });
  const [conflicts, setConflicts] = useState<ApiSyncConflict[]>([]);

  useEffect(() => {
    if (!navigator.onLine) return;
    listSyncConflicts("open").then(setConflicts).catch(() => setConflicts([]));
  }, []);

  const handleSave = async () => {
    const selected = currencyOptions.find(c => c.code === currency);
    const nextProfile = { ...profile, name, currency, currencySymbol: selected?.symbol || currency };
    setSaving(true);
    try {
      await patchMe({
        business_name: name,
        currency,
        currency_symbol: nextProfile.currencySymbol,
      });
      setProfile(nextProfile);
      toast.success("Settings saved!");
    } catch (e) {
      setProfile(nextProfile);
      toast.warning("Settings saved on this device.", { description: e instanceof Error ? e.message : "Server sync will retry after login." });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (key: "whatsappDaily" | "lowStockAlerts" | "discrepancyAlerts") => {
    setProfile({ ...profile, [key]: !profile[key] });
  };

  const toggleDarkMode = () => {
    setProfile({ ...profile, darkMode: !profile.darkMode });
  };

  const handleReset = () => {
    localStorage.clear();
    window.location.reload();
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleAddBranch = async () => {
    if (!branchForm.name.trim()) return;
    const isPrimary = branches.length === 0;
    try {
      const created = await createBranchApi({
        name: branchForm.name,
        code: branchForm.code,
        phone: branchForm.phone,
        address: branchForm.address,
        is_primary: isPrimary,
      });
      addBranch({
        name: created.name,
        code: created.code,
        phone: created.phone,
        address: created.address,
        isPrimary: created.is_primary,
      });
      setBranchForm({ name: "", code: "", phone: "", address: "" });
      toast.success("Branch added");
    } catch (e) {
      addBranch({ ...branchForm, isPrimary });
      setBranchForm({ name: "", code: "", phone: "", address: "" });
      toast.warning("Branch saved on this device.", { description: e instanceof Error ? e.message : "Server sync will retry later." });
    }
  };

  const handlePrimaryBranch = async (id: string) => {
    updateBranch(id, { isPrimary: true });
    if (/^\d+$/.test(id)) {
      try {
        await updateBranchApi(id, { is_primary: true });
      } catch {
        toast.warning("Primary branch changed locally.");
      }
    }
  };

  const handleDeleteBranch = async (id: string) => {
    deleteBranch(id);
    if (/^\d+$/.test(id)) {
      try {
        await deleteBranchApi(id);
      } catch {
        toast.warning("Branch removed locally. Server removal can be retried later.");
      }
    }
  };

  const handleResolveConflict = async (id: number) => {
    try {
      await resolveSyncConflict(id, "Reviewed from settings");
      setConflicts(prev => prev.filter(c => c.id !== id));
      toast.success("Conflict marked resolved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resolve conflict");
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <Card className="shadow-soft">
        <CardHeader><CardTitle className="font-display text-base">Business Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><Label>Business Name</Label><Input value={name} onChange={e => setName(e.target.value)} className="mt-1.5" /></div>
          <div>
            <Label>Currency</Label>
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {currencyOptions.map(c => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-hero text-primary-foreground">{saving ? "Saving..." : "Save Changes"}</Button>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader><CardTitle className="font-display text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Branches</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Branch Name</Label><Input value={branchForm.name} onChange={e => setBranchForm({ ...branchForm, name: e.target.value })} className="mt-1.5" placeholder="Main Shop" /></div>
            <div><Label>Code</Label><Input value={branchForm.code} onChange={e => setBranchForm({ ...branchForm, code: e.target.value })} className="mt-1.5" placeholder="MAIN" /></div>
            <div><Label>Phone</Label><Input value={branchForm.phone} onChange={e => setBranchForm({ ...branchForm, phone: e.target.value })} className="mt-1.5" /></div>
            <div><Label>Address</Label><Input value={branchForm.address} onChange={e => setBranchForm({ ...branchForm, address: e.target.value })} className="mt-1.5" /></div>
          </div>
          <Button onClick={handleAddBranch} disabled={!branchForm.name.trim()}>Add Branch</Button>
          <div className="space-y-2">
            {branches.map(branch => (
              <div key={branch.id} className="rounded-lg border border-border p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{branch.name} {branch.isPrimary && <span className="text-xs text-primary">(Primary)</span>}</p>
                  <p className="text-xs text-muted-foreground">{[branch.code, branch.phone, branch.address].filter(Boolean).join(" - ") || "No details yet"}</p>
                </div>
                <div className="flex gap-2">
                  {!branch.isPrimary && <Button size="sm" variant="outline" onClick={() => handlePrimaryBranch(branch.id)}>Make Primary</Button>}
                  <Button size="sm" variant="destructive" onClick={() => handleDeleteBranch(branch.id)}>Delete</Button>
                </div>
              </div>
            ))}
            {branches.length === 0 && <p className="text-sm text-muted-foreground">Add branches to track stock, sales, and staff by location.</p>}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader><CardTitle className="font-display text-base flex items-center gap-2"><GitPullRequest className="h-4 w-4" /> Offline Conflict Review</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {conflicts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open sync conflicts.</p>
          ) : conflicts.map(conflict => (
            <div key={conflict.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{conflict.action_type || "Offline action"}</p>
                  <p className="text-xs text-muted-foreground">{conflict.reason}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleResolveConflict(conflict.id)}>Mark Resolved</Button>
              </div>
              <pre className="mt-3 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(conflict.payload, null, 2)}</pre>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader><CardTitle className="font-display text-base">Appearance</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {profile.darkMode ? <Moon className="h-5 w-5 text-primary" /> : <Sun className="h-5 w-5 text-accent" />}
              <div>
                <p className="text-sm font-medium">Dark Mode</p>
                <p className="text-xs text-muted-foreground">Switch between light and dark themes</p>
              </div>
            </div>
            <Switch checked={profile.darkMode} onCheckedChange={toggleDarkMode} />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader><CardTitle className="font-display text-base">Notifications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">WhatsApp Daily Summary</p><p className="text-xs text-muted-foreground">Receive a sales summary every evening</p></div>
            <Switch checked={profile.whatsappDaily} onCheckedChange={() => handleToggle("whatsappDaily")} />
          </div>
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Low Stock Alerts</p><p className="text-xs text-muted-foreground">Get notified when items are running low</p></div>
            <Switch checked={profile.lowStockAlerts} onCheckedChange={() => handleToggle("lowStockAlerts")} />
          </div>
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium">Discrepancy Alerts</p><p className="text-xs text-muted-foreground">Instant alerts for stock mismatches</p></div>
            <Switch checked={profile.discrepancyAlerts} onCheckedChange={() => handleToggle("discrepancyAlerts")} />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader><CardTitle className="font-display text-base">Account</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">Sign out of this device and return to login.</p>
          <Button variant="outline" onClick={handleLogout}>Logout</Button>
        </CardContent>
      </Card>

      <Card className="shadow-soft border-destructive/20">
        <CardHeader><CardTitle className="font-display text-base text-destructive">Danger Zone</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">Reset all data and start fresh. This cannot be undone.</p>
          <Button variant="destructive" onClick={handleReset}>Reset All Data</Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;
