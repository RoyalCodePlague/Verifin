import { useEffect, useMemo, useState } from "react";
import { Check, FileUp, Landmark, Link2, Plus, RefreshCw, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createBankAccountApi,
  getCashFlowSummaryApi,
  getReconciliationCandidatesApi,
  importBankStatementApi,
  listBankAccountsApi,
  listBankStatementLinesApi,
  matchBankStatementLineApi,
  unmatchBankStatementLineApi,
  type ApiBankAccount,
  type ApiCashFlowSummary,
  type ApiBankStatementLine,
  type ApiReconciliationCandidate,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import { toast } from "sonner";

const BankReconciliation = () => {
  const { profile } = useStore();
  const [accounts, setAccounts] = useState<ApiBankAccount[]>([]);
  const [cashFlow, setCashFlow] = useState<ApiCashFlowSummary | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [lines, setLines] = useState<ApiBankStatementLine[]>([]);
  const [accountName, setAccountName] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0.00");
  const [currency, setCurrency] = useState(profile.currency || "ZAR");
  const [statementFile, setStatementFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [matchingLine, setMatchingLine] = useState<ApiBankStatementLine | null>(null);
  const [candidates, setCandidates] = useState<ApiReconciliationCandidate[]>([]);
  const [candidateKey, setCandidateKey] = useState("");
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const matchedCount = lines.filter((line) => line.is_reconciled).length;
  const unmatchedCount = lines.length - matchedCount;
  const currencies = useMemo(
    () => [...new Set([profile.currency || "ZAR", ...(profile.enabledCurrencies || [])])],
    [profile.currency, profile.enabledCurrencies]
  );

  const refreshAccounts = async (preferredId?: number) => {
    const data = await listBankAccountsApi();
    setAccounts(data);
    const nextId = preferredId ?? accountId ?? data[0]?.id ?? null;
    setAccountId(data.some((account) => account.id === nextId) ? nextId : data[0]?.id ?? null);
    return data;
  };

  const refreshLines = async (id: number) => {
    setLines(await listBankStatementLinesApi(id));
  };

  const refreshCashFlow = async () => {
    setCashFlow(await getCashFlowSummaryApi());
  };

  useEffect(() => {
    let active = true;
    Promise.all([listBankAccountsApi(), getCashFlowSummaryApi()])
      .then(([data, flow]) => {
        if (!active) return;
        setAccounts(data);
        setAccountId(data[0]?.id ?? null);
        setCashFlow(flow);
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : "Could not load bank accounts.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (accountId === null) {
      setLines([]);
      return;
    }
    let active = true;
    listBankStatementLinesApi(accountId)
      .then((data) => {
        if (active) setLines(data);
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : "Could not load statement lines.");
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  const addAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accountName.trim()) {
      toast.error("Enter an account name.");
      return;
    }
    setSaving(true);
    try {
      const account = await createBankAccountApi({
        name: accountName.trim(),
        currency,
        opening_balance: openingBalance || "0",
      });
      setAccountName("");
      await refreshAccounts(account.id);
      await refreshCashFlow();
      toast.success("Bank account added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add bank account.");
    } finally {
      setSaving(false);
    }
  };

  const importStatement = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accountId || !statementFile) {
      toast.error("Choose an account and a CSV statement.");
      return;
    }
    setSaving(true);
    try {
      const result = await importBankStatementApi(accountId, statementFile);
      await Promise.all([refreshAccounts(accountId), refreshLines(accountId), refreshCashFlow()]);
      setStatementFile(null);
      toast.success(`Imported ${result.created} lines; skipped ${result.skipped} duplicates.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import statement.");
    } finally {
      setSaving(false);
    }
  };

  const openMatch = async (line: ApiBankStatementLine) => {
    setMatchingLine(line);
    setCandidates([]);
    setCandidateKey("");
    setLoadingCandidates(true);
    try {
      const data = await getReconciliationCandidatesApi(line.id);
      setCandidates(data);
      if (data.length) setCandidateKey(`${data[0].type}:${data[0].id}`);
      if (!data.length) toast.info("No matching records found within 14 days of this statement date.");
    } catch (error) {
      setMatchingLine(null);
      toast.error(error instanceof Error ? error.message : "Could not find matching records.");
    } finally {
      setLoadingCandidates(false);
    }
  };

  const reconcile = async () => {
    if (!matchingLine) return;
    const candidate = candidates.find((item) => `${item.type}:${item.id}` === candidateKey);
    if (!candidate) {
      toast.error("Choose a record to match.");
      return;
    }
    setSaving(true);
    try {
      await matchBankStatementLineApi(matchingLine.id, candidate);
      await Promise.all([refreshAccounts(accountId ?? undefined), refreshLines(matchingLine.account), refreshCashFlow()]);
      setMatchingLine(null);
      toast.success("Statement line reconciled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reconcile this line.");
    } finally {
      setSaving(false);
    }
  };

  const unmatch = async (line: ApiBankStatementLine) => {
    setSaving(true);
    try {
      await unmatchBankStatementLineApi(line.id);
      await Promise.all([refreshAccounts(accountId ?? undefined), refreshLines(line.account), refreshCashFlow()]);
      toast.success("Statement line unmatched.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not unmatch this line.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Bank reconciliation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Import a bank CSV, then match statement entries to recorded sales, expenses, and supplier payments.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4" /> Bank accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {accounts.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((account) => (
                <button
                  type="button"
                  key={account.id}
                  onClick={() => setAccountId(account.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${account.id === accountId ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                >
                  <span className="block font-medium">{account.name}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {account.currency} {Number(account.statement_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {account.unreconciled_count} unmatched
                  </span>
                </button>
              ))}
            </div>
          )}

          <form onSubmit={addAccount} className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="bank-name">Account name</Label>
              <Input id="bank-name" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="e.g. Main bank account" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank-currency">Currency</Label>
              <select id="bank-currency" value={currency} onChange={(event) => setCurrency(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opening-balance">Opening balance</Label>
              <Input id="opening-balance" type="number" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={saving} className="w-full"><Plus className="mr-2 h-4 w-4" /> Add account</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {selectedAccount && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Import {selectedAccount.name} statement</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={importStatement} className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <div className="space-y-1.5">
                  <Label htmlFor="statement-file">CSV statement</Label>
                  <Input
                    id="statement-file"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => setStatementFile(event.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Required columns: date, description, amount. Optional: reference. Use YYYY-MM-DD or DD/MM/YYYY dates, dot decimals, positive deposits, and negative withdrawals.
                  </p>
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={saving || !statementFile} className="w-full sm:w-auto">
                    <FileUp className="mr-2 h-4 w-4" /> Import CSV
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Statement activity</CardTitle>
              <div className="flex gap-2">
                <Badge variant="outline">{matchedCount} reconciled</Badge>
                <Badge variant={unmatchedCount ? "destructive" : "secondary"}>{unmatchedCount} unmatched</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading bank accounts...</p>
              ) : lines.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="font-medium">No statement lines yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Import a CSV statement to start reconciling.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {lines.map((line) => (
                    <div key={line.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{line.description}</span>
                          {line.is_reconciled && <Badge variant="secondary"><Check className="mr-1 h-3 w-3" /> Reconciled</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {line.transaction_date}{line.reference ? ` · Ref ${line.reference}` : ""}
                          {line.is_reconciled ? ` · ${line.matched_transaction_type?.replace("_", " ")} #${line.matched_transaction_id}` : ""}
                        </p>
                      </div>
                      <div className={`font-semibold tabular-nums ${Number(line.amount) >= 0 ? "text-emerald-700" : "text-destructive"}`}>
                        {selectedAccount.currency} {Number(line.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      {line.is_reconciled ? (
                        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void unmatch(line)}>
                          <Unlink className="mr-2 h-4 w-4" /> Unmatch
                        </Button>
                      ) : (
                        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void openMatch(line)}>
                          <Link2 className="mr-2 h-4 w-4" /> Find match
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {cashFlow && cashFlow.monthly.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Monthly bank cash flow</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Month</th>
                    <th className="py-2 pr-3 font-medium">Account</th>
                    <th className="py-2 pr-3 text-right font-medium">Money in</th>
                    <th className="py-2 pr-3 text-right font-medium">Money out</th>
                    <th className="py-2 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {cashFlow.monthly.slice().reverse().map((row) => (
                    <tr key={`${row.account_id}:${row.month}`} className="border-b last:border-0">
                      <td className="py-2 pr-3">{row.month.slice(0, 7)}</td>
                      <td className="py-2 pr-3">{row.account_name} ({row.currency})</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{Number(row.inflows).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{Number(row.outflows).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className={`py-2 text-right font-medium tabular-nums ${Number(row.net) < 0 ? "text-destructive" : ""}`}>
                        {Number(row.net).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && accounts.length === 0 && (
        <p className="text-sm text-muted-foreground">Add a bank account above before importing a statement.</p>
      )}

      {matchingLine && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Match: {matchingLine.description}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMatchingLine(null)}>Close</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingCandidates ? (
              <p className="text-sm text-muted-foreground">Looking for matching records...</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No exact-amount records in the same currency were found near this date.</p>
            ) : (
              <>
                <Label htmlFor="reconciliation-candidate">Matching records</Label>
                <select
                  id="reconciliation-candidate"
                  value={candidateKey}
                  onChange={(event) => setCandidateKey(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {candidates.map((candidate) => (
                    <option key={`${candidate.type}:${candidate.id}`} value={`${candidate.type}:${candidate.id}`}>
                      {candidate.date} · {candidate.label} · {selectedAccount?.currency} {candidate.amount}
                    </option>
                  ))}
                </select>
                <div className="flex justify-end">
                  <Button type="button" disabled={saving || !candidateKey} onClick={() => void reconcile()}>
                    <Check className="mr-2 h-4 w-4" /> Reconcile line
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Button type="button" variant="ghost" size="sm" onClick={() => {
        if (!accountId) return;
        void Promise.all([refreshAccounts(accountId), refreshLines(accountId), refreshCashFlow()]).catch((error) => {
          toast.error(error instanceof Error ? error.message : "Could not refresh bank data.");
        });
      }}>
        <RefreshCw className="mr-2 h-4 w-4" /> Refresh
      </Button>
    </div>
  );
};

export default BankReconciliation;
