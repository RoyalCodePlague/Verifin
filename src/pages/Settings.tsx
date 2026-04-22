import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Clock3,
  Cloud,
  CloudOff,
  Loader2,
  Lock,
  Moon,
  Shield,
  Sun,
  UserRound,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth-context";
import {
  createNotificationPreferencesApi,
  changePasswordRequest,
  fetchNotificationPreferencesApi,
  getAccessToken,
  listSyncConflicts,
  logoutOtherDevicesRequest,
  patchMe,
  pushOfflineActions,
  updateNotificationPreferencesApi,
} from "@/lib/api";
import {
  clearAuthenticatedOfflineSession,
  clearOfflineQueue,
  getLastSuccessfulSync,
  getOfflineQueue,
  hasAuthenticatedOfflineSession,
  isOfflineAccessEnabled,
  isOnline,
  LAST_SUCCESSFUL_SYNC_KEY,
  markAuthenticatedOfflineSession,
  setLastSuccessfulSync,
  setOfflineAccessEnabled,
} from "@/lib/offlineQueue";
import { useStore } from "@/lib/store";
import { currencyOptions, getDetectedCountryCode, getRegionalCurrencyDefaults, symbolForCurrency } from "@/lib/currency";

const SECURITY_PREFS_KEY = "sp_security_prefs";
const EXTENDED_NOTIFICATION_PREFS_KEY = "sp_extended_notification_prefs";

type SecurityPrefs = {
  offlineAccessEnabled: boolean;
  appLockEnabled: boolean;
  lockAfterMinutes: number;
};

type ExtendedNotificationPrefs = {
  pushEnabled: boolean;
  emailDailySummary: boolean;
  auditCompletionAlerts: boolean;
  billingAlerts: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatRelativeSync(timestamp: string | null) {
  if (!timestamp) return "No sync yet";
  const date = new Date(timestamp);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.max(Math.floor(diffMs / 60000), 0);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} mins ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? "" : "s"} ago`;

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SettingsPage = () => {
  const { profile, setProfile } = useStore();
  const { logout, refreshUser, user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(profile.name);
  const [currency, setCurrency] = useState(profile.currency);
  const [secondaryCurrency, setSecondaryCurrency] = useState("");
  const [secondaryRate, setSecondaryRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(() => isOnline());
  const [queueCount, setQueueCount] = useState(() => getOfflineQueue().length);
  const [conflictCount, setConflictCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(() => getLastSuccessfulSync());
  const [securityPrefs, setSecurityPrefs] = useState<SecurityPrefs>(() =>
    loadJson<SecurityPrefs>(SECURITY_PREFS_KEY, {
      offlineAccessEnabled: isOfflineAccessEnabled(),
      appLockEnabled: false,
      lockAfterMinutes: 15,
    })
  );
  const [notificationPrefs, setNotificationPrefs] = useState<ExtendedNotificationPrefs>(() =>
    loadJson<ExtendedNotificationPrefs>(EXTENDED_NOTIFICATION_PREFS_KEY, {
      pushEnabled: true,
      emailDailySummary: false,
      auditCompletionAlerts: true,
      billingAlerts: true,
      quietHoursEnabled: false,
      quietHoursStart: "21:00",
      quietHoursEnd: "06:00",
    })
  );
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [loggingOutOthers, setLoggingOutOthers] = useState(false);
  const detectedCountry = getDetectedCountryCode();
  const detectedDefaults = getRegionalCurrencyDefaults(detectedCountry);

  useEffect(() => {
    setName(profile.name);
    setCurrency(profile.currency);
    const existingSecondary = (profile.enabledCurrencies || []).find((code) => code !== profile.currency) || "";
    setSecondaryCurrency(existingSecondary);
    setSecondaryRate(existingSecondary ? String(profile.exchangeRates?.[existingSecondary] ?? "") : "");
  }, [profile.name, profile.currency, profile.enabledCurrencies, profile.exchangeRates]);

  useEffect(() => {
    const refreshStatus = () => {
      setOnline(isOnline());
      setQueueCount(getOfflineQueue().length);
      setLastSyncAt(getLastSuccessfulSync());
    };

    refreshStatus();
    const timer = window.setInterval(refreshStatus, 30000);
    window.addEventListener("online", refreshStatus);
    window.addEventListener("offline", refreshStatus);
    window.addEventListener("storage", refreshStatus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refreshStatus);
      window.removeEventListener("offline", refreshStatus);
      window.removeEventListener("storage", refreshStatus);
    };
  }, []);

  useEffect(() => {
    saveJson(SECURITY_PREFS_KEY, securityPrefs);
    setOfflineAccessEnabled(securityPrefs.offlineAccessEnabled);
    if (securityPrefs.offlineAccessEnabled) {
      markAuthenticatedOfflineSession();
    } else {
      clearAuthenticatedOfflineSession();
    }
  }, [securityPrefs]);

  useEffect(() => {
    saveJson(EXTENDED_NOTIFICATION_PREFS_KEY, notificationPrefs);
  }, [notificationPrefs]);

  useEffect(() => {
    if (!online || !getAccessToken()) {
      setConflictCount(0);
      return;
    }

    let cancelled = false;
    void listSyncConflicts("open")
      .then((conflicts) => {
        if (!cancelled) setConflictCount(conflicts.length);
      })
      .catch(() => {
        if (!cancelled) setConflictCount(0);
      });

    return () => {
      cancelled = true;
    };
  }, [online, queueCount]);

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
      const savedUser = await patchMe({
        business_name: name,
        currency: baseCurrency,
        currency_symbol: nextProfile.currencySymbol,
        enabled_currencies: enabledCurrencies,
        exchange_rates: exchangeRates,
        dark_mode: nextProfile.darkMode,
      });

      const preferences = await fetchNotificationPreferencesApi();
      const preferencePayload = {
        whatsapp_daily: nextProfile.whatsappDaily,
        low_stock_alerts: nextProfile.lowStockAlerts,
        discrepancy_alerts: nextProfile.discrepancyAlerts,
        push_enabled: notificationPrefs.pushEnabled,
      };

      if (preferences[0]) {
        await updateNotificationPreferencesApi(preferences[0].id, preferencePayload);
      } else {
        await createNotificationPreferencesApi(preferencePayload);
      }

      setProfile(nextProfile);
      localStorage.setItem("sp_cached_user", JSON.stringify(savedUser));
      await refreshUser();
      toast.success("Settings saved!");
    } catch (e) {
      setProfile(nextProfile);
      toast.warning("Settings saved on this device.", {
        description: e instanceof Error ? e.message : "Server sync will retry after login.",
      });
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

  const handleChangePassword = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast.error("Fill in all password fields.");
      return;
    }

    setChangingPassword(true);
    try {
      const result = await changePasswordRequest({
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
        confirm_password: passwordForm.confirmPassword,
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast.success(result.detail || "Password updated successfully.");
    } catch (error) {
      toast.error("Could not update password.", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleLogoutOtherDevices = async () => {
    setLoggingOutOthers(true);
    try {
      const result = await logoutOtherDevicesRequest();
      toast.success(result.detail || "Other devices logged out successfully.", {
        description: typeof result.revoked === "number" ? `${result.revoked} other session${result.revoked === 1 ? "" : "s"} revoked.` : undefined,
      });
    } catch (error) {
      toast.error("Could not log out other devices.", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLoggingOutOthers(false);
    }
  };

  const handleSyncNow = async () => {
    const queue = getOfflineQueue();
    setQueueCount(queue.length);

    if (!getAccessToken()) {
      toast.error("Please log in again to sync your offline changes.");
      return;
    }

    if (!navigator.onLine) {
      toast.error("You are offline. Reconnect and try again.");
      return;
    }

    if (queue.length === 0) {
      toast.message("Everything is already synced.");
      return;
    }

    setSyncing(true);
    try {
      const result = await pushOfflineActions(queue);
      const syncSucceeded = (result.errors?.length ?? 0) === 0;

      if (syncSucceeded) {
        clearOfflineQueue();
        const syncedAt = new Date().toISOString();
        setLastSuccessfulSync(syncedAt);
        localStorage.setItem(LAST_SUCCESSFUL_SYNC_KEY, syncedAt);
        setLastSyncAt(syncedAt);
        setQueueCount(0);
        await refreshUser();
        toast.success(`Synced ${result.processed} offline change${result.processed === 1 ? "" : "s"}.`);
      } else {
        toast.warning("Some offline changes still need review.");
      }

      if (result.errors?.length) {
        setConflictCount(result.errors.length);
      }
    } catch (error) {
      toast.error("Offline sync failed.", {
        description: error instanceof Error ? error.message : "We will retry when your connection is stable.",
      });
    } finally {
      setSyncing(false);
    }
  };

  const syncSummary = useMemo(() => {
    if (!online) return "You are offline. Changes will stay on this device until connection returns.";
    if (queueCount > 0) return `${queueCount} queued change${queueCount === 1 ? "" : "s"} waiting to sync.`;
    return "Your device is connected and there are no pending offline changes.";
  }, [online, queueCount]);

  const authenticatedOffline = hasAuthenticatedOfflineSession();

  return (
    <div className="max-w-4xl space-y-6">
      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="font-display text-base">Business Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Business Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label>Base Currency</Label>
            <select
              value={currency}
              onChange={(e) => {
                const nextCurrency = e.target.value;
                setCurrency(nextCurrency);
                if (secondaryCurrency === nextCurrency) {
                  setSecondaryCurrency("");
                  setSecondaryRate("");
                }
              }}
              className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {currencyOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
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
              onChange={(e) => {
                const nextSecondary = e.target.value;
                setSecondaryCurrency(nextSecondary);
                setSecondaryRate(nextSecondary ? String(profile.exchangeRates?.[nextSecondary] ?? "") : "");
              }}
              className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">None</option>
              {currencyOptions
                .filter((option) => option.code !== currency)
                .map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
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
                onChange={(e) => setSecondaryRate(e.target.value)}
                className="mt-1.5"
                placeholder={`Rate from ${secondaryCurrency} to ${currency}`}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Expenses in {secondaryCurrency} will be converted into {currency} using this rate.
              </p>
            </div>
          ) : null}
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-hero text-primary-foreground">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="font-display text-base">Backup & Sync Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/20 p-4 dark:bg-muted/10">
              <div className="flex items-center gap-2 text-sm font-medium">
                {online ? <Cloud className="h-4 w-4 text-emerald-500" /> : <CloudOff className="h-4 w-4 text-amber-500" />}
                Connection
              </div>
              <p className="mt-2 text-lg font-semibold">{online ? "Online" : "Offline"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{syncSummary}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4 dark:bg-muted/10">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock3 className="h-4 w-4 text-primary" />
                Pending Queue
              </div>
              <p className="mt-2 text-lg font-semibold">{queueCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">Offline actions waiting to be pushed to your online database.</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4 dark:bg-muted/10">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Shield className="h-4 w-4 text-sky-500" />
                Sync Health
              </div>
              <p className="mt-2 text-lg font-semibold">{conflictCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {conflictCount === 0 ? "No sync conflicts detected." : "Some changes need review before they can finish syncing."}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background p-4 dark:bg-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Last successful sync</p>
                <p className="text-xs text-muted-foreground">{formatRelativeSync(lastSyncAt)}</p>
              </div>
              <Button onClick={() => void handleSyncNow()} disabled={syncing || !online}>
                {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Sync Now
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="font-display text-base">Appearance</CardTitle>
        </CardHeader>
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
        <CardHeader>
          <CardTitle className="font-display text-base">Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <Bell className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <p className="text-sm font-medium">Push Notifications</p>
                <p className="text-xs text-muted-foreground">Allow alerts in the app for inventory, audits, and daily activity.</p>
              </div>
            </div>
            <Switch
              checked={notificationPrefs.pushEnabled}
              onCheckedChange={(checked) => setNotificationPrefs((prev) => ({ ...prev, pushEnabled: checked }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">WhatsApp Daily Summary</p>
              <p className="text-xs text-muted-foreground">Receive a sales summary every evening.</p>
            </div>
            <Switch checked={profile.whatsappDaily} onCheckedChange={() => handleToggle("whatsappDaily")} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Low Stock Alerts</p>
              <p className="text-xs text-muted-foreground">Get notified when items are running low.</p>
            </div>
            <Switch checked={profile.lowStockAlerts} onCheckedChange={() => handleToggle("lowStockAlerts")} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Discrepancy Alerts</p>
              <p className="text-xs text-muted-foreground">Instant alerts for stock mismatches.</p>
            </div>
            <Switch checked={profile.discrepancyAlerts} onCheckedChange={() => handleToggle("discrepancyAlerts")} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Email Daily Summary</p>
              <p className="text-xs text-muted-foreground">Prepare a separate email summary preference for later server delivery.</p>
            </div>
            <Switch
              checked={notificationPrefs.emailDailySummary}
              onCheckedChange={(checked) => setNotificationPrefs((prev) => ({ ...prev, emailDailySummary: checked }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Audit Completion Alerts</p>
              <p className="text-xs text-muted-foreground">Highlight completed background audits and review-ready findings.</p>
            </div>
            <Switch
              checked={notificationPrefs.auditCompletionAlerts}
              onCheckedChange={(checked) => setNotificationPrefs((prev) => ({ ...prev, auditCompletionAlerts: checked }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Billing Alerts</p>
              <p className="text-xs text-muted-foreground">Keep reminders ready for renewals, trial end, and plan changes.</p>
            </div>
            <Switch
              checked={notificationPrefs.billingAlerts}
              onCheckedChange={(checked) => setNotificationPrefs((prev) => ({ ...prev, billingAlerts: checked }))}
            />
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-4 dark:bg-muted/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Quiet Hours</p>
                <p className="text-xs text-muted-foreground">Keep less urgent alerts quieter during your chosen hours.</p>
              </div>
              <Switch
                checked={notificationPrefs.quietHoursEnabled}
                onCheckedChange={(checked) => setNotificationPrefs((prev) => ({ ...prev, quietHoursEnabled: checked }))}
              />
            </div>
            {notificationPrefs.quietHoursEnabled ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Start</Label>
                  <Input
                    type="time"
                    className="mt-1.5"
                    value={notificationPrefs.quietHoursStart}
                    onChange={(e) => setNotificationPrefs((prev) => ({ ...prev, quietHoursStart: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>End</Label>
                  <Input
                    type="time"
                    className="mt-1.5"
                    value={notificationPrefs.quietHoursEnd}
                    onChange={(e) => setNotificationPrefs((prev) => ({ ...prev, quietHoursEnd: e.target.value }))}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="font-display text-base">Security</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted/20 p-4 dark:bg-muted/10">
              <div className="flex items-center gap-2 text-sm font-medium">
                <UserRound className="h-4 w-4 text-primary" />
                Signed In Account
              </div>
              <p className="mt-2 text-sm font-semibold">{user?.email || "Unknown account"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{user?.business_name || profile.name || "Business profile not set yet"}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4 dark:bg-muted/10">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Lock className="h-4 w-4 text-primary" />
                Session Status
              </div>
              <p className="mt-2 text-sm font-semibold">{authenticatedOffline ? "Trusted for offline work" : "Online sign-in only"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {authenticatedOffline
                  ? "This device can queue work offline and sync later."
                  : "Offline queue protection is disabled on this device."}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Allow Offline Access On This Device</p>
              <p className="text-xs text-muted-foreground">Keep working when internet drops and sync back to the online database later.</p>
            </div>
            <Switch
              checked={securityPrefs.offlineAccessEnabled}
              onCheckedChange={(checked) => setSecurityPrefs((prev) => ({ ...prev, offlineAccessEnabled: checked }))}
            />
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-4 dark:bg-muted/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-Lock Reminder</p>
                <p className="text-xs text-muted-foreground">Prepare this device for timed app locking once session lock is connected.</p>
              </div>
              <Switch
                checked={securityPrefs.appLockEnabled}
                onCheckedChange={(checked) => setSecurityPrefs((prev) => ({ ...prev, appLockEnabled: checked }))}
              />
            </div>
            {securityPrefs.appLockEnabled ? (
              <div className="mt-4">
                <Label>Lock after inactivity</Label>
                <select
                  value={String(securityPrefs.lockAfterMinutes)}
                  onChange={(e) => setSecurityPrefs((prev) => ({ ...prev, lockAfterMinutes: Number(e.target.value) }))}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {[5, 10, 15, 30, 60].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-background p-4 dark:bg-card">
            <p className="text-sm font-medium">Change Password</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Update your account password for this Verifin account.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div>
                <Label>Current Password</Label>
                <Input
                  type="password"
                  className="mt-1.5"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
                />
              </div>
              <div>
                <Label>New Password</Label>
                <Input
                  type="password"
                  className="mt-1.5"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                />
              </div>
              <div>
                <Label>Confirm New Password</Label>
                <Input
                  type="password"
                  className="mt-1.5"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => void handleChangePassword()} disabled={changingPassword}>
                {changingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Update Password
              </Button>
              <Button variant="outline" onClick={() => void handleLogoutOtherDevices()} disabled={loggingOutOthers}>
                {loggingOutOthers ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Logout Other Devices
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="font-display text-base">Account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">Sign out of this device and return to login.</p>
          <Button variant="outline" onClick={handleLogout}>Logout</Button>
        </CardContent>
      </Card>

      <Card className="shadow-soft border-destructive/20">
        <CardHeader>
          <CardTitle className="font-display text-base text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">Reset all data and start fresh. This cannot be undone.</p>
          <Button variant="destructive" onClick={handleReset}>Reset All Data</Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;
