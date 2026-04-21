import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { patchMe } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useNavigate } from "react-router-dom";
import { currencyOptions, getDetectedCountryCode, getRegionalCurrencyDefaults, symbolForCurrency } from "@/lib/currency";

const SettingsPage = () => {
  const { profile, setProfile } = useStore();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(profile.name);
  const [currency, setCurrency] = useState(profile.currency);
  const [secondaryCurrency, setSecondaryCurrency] = useState("");
  const [secondaryRate, setSecondaryRate] = useState("");
  const [saving, setSaving] = useState(false);
  const detectedCountry = getDetectedCountryCode();
  const detectedDefaults = getRegionalCurrencyDefaults(detectedCountry);

  useEffect(() => {
    setName(profile.name);
    setCurrency(profile.currency);
    const existingSecondary = (profile.enabledCurrencies || []).find((code) => code !== profile.currency) || "";
    setSecondaryCurrency(existingSecondary);
    setSecondaryRate(existingSecondary ? String(profile.exchangeRates?.[existingSecondary] ?? "") : "");
  }, [profile.name, profile.currency, profile.enabledCurrencies, profile.exchangeRates]);

  const handleSave = async () => {
    const baseCurrency = currency.trim().toUpperCase();
    const nextSecondary = secondaryCurrency && secondaryCurrency !== baseCurrency ? secondaryCurrency : "";
    const enabledCurrencies = nextSecondary ? [baseCurrency, nextSecondary] : [baseCurrency];
    const exchangeRates = nextSecondary && secondaryRate
      ? { [nextSecondary]: parseFloat(secondaryRate) || 0 }
      : {};

    if (nextSecondary && (!exchangeRates[nextSecondary] || exchangeRates[nextSecondary] <= 0)) {
      toast.error(`Enter a valid rate for ${nextSecondary}.`);
      return;
    }

    const nextProfile = {
      ...profile,
      name,
      currency: baseCurrency,
      currencySymbol: symbolForCurrency(baseCurrency),
      enabledCurrencies,
      exchangeRates,
    };

    setSaving(true);
    try {
      await patchMe({
        business_name: name,
        currency: baseCurrency,
        currency_symbol: nextProfile.currencySymbol,
        enabled_currencies: enabledCurrencies,
        exchange_rates: exchangeRates,
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

  const applyRegionDefaults = () => {
    setCurrency(detectedDefaults.baseCurrency);
    if (detectedDefaults.secondaryCurrency && detectedDefaults.secondaryCurrency !== detectedDefaults.baseCurrency) {
      setSecondaryCurrency(detectedDefaults.secondaryCurrency);
      setSecondaryRate(String(profile.exchangeRates?.[detectedDefaults.secondaryCurrency] ?? ""));
    } else {
      setSecondaryCurrency("");
      setSecondaryRate("");
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

  return (
    <div className="space-y-6 max-w-2xl">
      <Card className="shadow-soft">
        <CardHeader><CardTitle className="font-display text-base">Business Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><Label>Business Name</Label><Input value={name} onChange={e => setName(e.target.value)} className="mt-1.5" /></div>
          <div>
            <Label>Base Currency</Label>
            <select
              value={currency}
              onChange={e => {
                const nextCurrency = e.target.value;
                setCurrency(nextCurrency);
                if (secondaryCurrency === nextCurrency) {
                  setSecondaryCurrency("");
                  setSecondaryRate("");
                }
              }}
              className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {currencyOptions.map(c => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Region detected: {detectedCountry}. Base currency suggestion: {detectedDefaults.baseCurrency}.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={applyRegionDefaults}>
                Use Region Default
              </Button>
            </div>
          </div>
          <div>
            <Label>Second Currency</Label>
            <select
              value={secondaryCurrency}
              onChange={e => {
                const nextSecondary = e.target.value;
                setSecondaryCurrency(nextSecondary);
                setSecondaryRate(nextSecondary ? String(profile.exchangeRates?.[nextSecondary] ?? "") : "");
              }}
              className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">None</option>
              {currencyOptions
                .filter((option) => option.code !== currency)
                .map((option) => (
                  <option key={option.code} value={option.code}>{option.label}</option>
                ))}
            </select>
          </div>
          {secondaryCurrency ? (
            <div>
              <Label>1 {secondaryCurrency} equals how many {currency}?</Label>
              <Input
                type="number"
                min="0"
                step="0.000001"
                value={secondaryRate}
                onChange={e => setSecondaryRate(e.target.value)}
                className="mt-1.5"
                placeholder={`Rate from ${secondaryCurrency} to ${currency}`}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Expenses in {secondaryCurrency} will be converted into {currency} using this rate.
              </p>
            </div>
          ) : null}
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-hero text-primary-foreground">{saving ? "Saving..." : "Save Changes"}</Button>
        </CardContent>
      </Card>

      {/*
      Multi-branch is disabled for now. Keep this settings block for later reactivation.
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
