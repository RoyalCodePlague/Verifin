import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { patchMe } from "@/lib/api";

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
  const { profile, setProfile } = useStore();
  const [name, setName] = useState(profile.name);
  const [currency, setCurrency] = useState(profile.currency);
  const [saving, setSaving] = useState(false);

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
