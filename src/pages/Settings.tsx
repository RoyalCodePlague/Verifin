import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { Building2, Moon, Sun, Trash2 } from "lucide-react";
import { patchMe } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useNavigate } from "react-router-dom";
import { useFeatureAccess, useUpgradePrompt } from "@/lib/features";

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
  const { profile, setProfile, branches, addBranch, updateBranch, deleteBranch } = useStore();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { canUse } = useFeatureAccess();
  const promptUpgrade = useUpgradePrompt();
  const [name, setName] = useState(profile.name);
  const [currency, setCurrency] = useState(profile.currency);
  const [branchForm, setBranchForm] = useState({ name: "", code: "", phone: "", address: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(profile.name);
    setCurrency(profile.currency);
  }, [profile.name, profile.currency]);

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

  const handleAddBranch = () => {
    if (!canUse("multi_branch")) {
      promptUpgrade("multi_branch", "Multi-branch controls");
      return;
    }
    if (!branchForm.name.trim()) return;
    addBranch({ ...branchForm, isPrimary: branches.length === 0 });
    setBranchForm({ name: "", code: "", phone: "", address: "" });
    toast.success("Branch added.");
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
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
          {!canUse("multi_branch") && (
            <div className="rounded-lg border border-dashed p-4 text-sm">
              <p className="font-semibold">Multi-branch is a Business feature.</p>
              <p className="mt-1 text-muted-foreground">Unlock branch switching, stock segmentation, and branch-specific reporting.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => promptUpgrade("multi_branch", "Multi-branch controls")}>Upgrade</Button>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Branch Name</Label><Input disabled={!canUse("multi_branch")} value={branchForm.name} onChange={e => setBranchForm({ ...branchForm, name: e.target.value })} className="mt-1.5" placeholder="Main Shop" /></div>
            <div><Label>Code</Label><Input disabled={!canUse("multi_branch")} value={branchForm.code} onChange={e => setBranchForm({ ...branchForm, code: e.target.value })} className="mt-1.5" placeholder="MAIN" /></div>
            <div><Label>Phone</Label><Input disabled={!canUse("multi_branch")} value={branchForm.phone} onChange={e => setBranchForm({ ...branchForm, phone: e.target.value })} className="mt-1.5" /></div>
            <div><Label>Address</Label><Input disabled={!canUse("multi_branch")} value={branchForm.address} onChange={e => setBranchForm({ ...branchForm, address: e.target.value })} className="mt-1.5" /></div>
          </div>
          <Button onClick={handleAddBranch} disabled={!branchForm.name.trim()}>Add Branch</Button>
          <div className="space-y-2">
            {branches.map(branch => (
              <div key={branch.id} className="rounded-lg border border-border p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{branch.name} {branch.isPrimary && <span className="text-xs text-primary">(Primary)</span>}</p>
                  <p className="text-xs text-muted-foreground">{[branch.code, branch.phone, branch.address].filter(Boolean).join(" - ") || "No details yet"}</p>
                </div>
                {canUse("multi_branch") && (
                  <div className="flex gap-2">
                    {!branch.isPrimary && <Button size="sm" variant="outline" onClick={() => updateBranch(branch.id, { isPrimary: true })}>Make Primary</Button>}
                    <Button size="sm" variant="destructive" onClick={() => deleteBranch(branch.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/*
      Multiple branches are disabled for now. Keep this block for later reactivation.
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
      */}

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
