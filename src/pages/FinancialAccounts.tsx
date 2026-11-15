import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, Plus, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createAccountTransactionApi,
  createAccountTransferApi,
  createFinancialAccountApi,
  getFinancialAccountBalanceApi,
  listAccountTransactionsApi,
  listFinancialAccountsApi,
  reconcileAccountBalanceApi,
  reconcileAccountTransactionApi,
  type ApiFinancialAccount,
  updateFinancialAccountApi,
} from "@/lib/api";
import { useStore } from "@/lib/store";

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const accountTypes: Array<{ value: ApiFinancialAccount["account_type"]; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank account" },
  { value: "ecocash", label: "EcoCash" },
  { value: "innbucks", label: "InnBucks" },
  { value: "mobile_money", label: "Other mobile money" },
  { value: "custom", label: "Custom" },
];

const EMPTY_ACCOUNTS: ApiFinancialAccount[] = [];

const money = (amount: string | number, currency: string) =>
  `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FinancialAccounts = () => {
  const queryClient = useQueryClient();
  const { profile } = useStore();
  const [accountForm, setAccountForm] = useState({
    name: "",
    account_type: "cash" as ApiFinancialAccount["account_type"],
    provider_name: "",
    currency: profile.currency,
    opening_balance: "0.00",
    opening_fx_rate_to_base: "",
    opening_date: today(),
  });
  const [transactionForm, setTransactionForm] = useState({
    account: "none",
    direction: "in" as "in" | "out",
    amount: "",
    fx_rate_to_base: "",
    transaction_date: today(),
    description: "",
    reference: "",
  });
  const [transferForm, setTransferForm] = useState({
    from_account: "none",
    to_account: "none",
    amount_from: "",
    exchange_rate: "",
    fx_rate_to_base: "",
    transaction_date: today(),
    description: "",
    reference: "",
  });
  const [historyAccount, setHistoryAccount] = useState("all");
  const [balanceAsOf, setBalanceAsOf] = useState(today());
  const [balanceForm, setBalanceForm] = useState({ actual_balance: "", note: "", post_adjustment: false, fx_rate_to_base: "" });
  const transactionRequestKey = useRef<string | null>(null);
  const transferRequestKey = useRef<string | null>(null);
  useEffect(() => {
    transactionRequestKey.current = null;
  }, [transactionForm]);
  useEffect(() => {
    transferRequestKey.current = null;
  }, [transferForm]);

  const accountsQuery = useQuery({
    queryKey: ["financial-accounts"],
    queryFn: listFinancialAccountsApi,
    retry: false,
  });
  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS;
  const activeAccounts = useMemo(() => accounts.filter((account) => account.is_active), [accounts]);
  const transactionAccount = activeAccounts.find((account) => String(account.id) === transactionForm.account);
  const selectedHistoryAccount = accounts.find((account) => String(account.id) === historyAccount);
  const transferSource = activeAccounts.find((account) => String(account.id) === transferForm.from_account);
  const transferDestination = activeAccounts.find((account) => String(account.id) === transferForm.to_account);
  const transactionsQuery = useQuery({
    queryKey: ["account-transactions", historyAccount],
    queryFn: () => listAccountTransactionsApi(historyAccount === "all" ? undefined : Number(historyAccount)),
    enabled: accounts.length > 0,
    retry: false,
  });
  const transactions = transactionsQuery.data ?? [];
  const closingBalanceQuery = useQuery({
    queryKey: ["financial-account-balance", historyAccount, balanceAsOf],
    queryFn: () => getFinancialAccountBalanceApi(Number(historyAccount), balanceAsOf),
    enabled: historyAccount !== "all" && !!balanceAsOf,
    retry: false,
  });
  const invalidateAccounts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["financial-accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] }),
    ]);
  };

  const createAccount = useMutation({
    mutationFn: createFinancialAccountApi,
    onSuccess: async () => {
      toast.success("Financial account created.");
      setAccountForm({
        name: "",
        account_type: "cash",
        provider_name: "",
        currency: profile.currency,
        opening_balance: "0.00",
        opening_fx_rate_to_base: "",
        opening_date: today(),
      });
      await invalidateAccounts();
    },
    onError: (error) => toast.error(error.message),
  });
  const createTransaction = useMutation({
    mutationFn: createAccountTransactionApi,
    onSuccess: async () => {
      toast.success("Account transaction posted.");
      transactionRequestKey.current = null;
      setTransactionForm((form) => ({ ...form, amount: "", fx_rate_to_base: "", description: "", reference: "" }));
      await invalidateAccounts();
    },
    onError: (error) => toast.error(error.message),
  });
  const createTransfer = useMutation({
    mutationFn: createAccountTransferApi,
    onSuccess: async () => {
      toast.success("Transfer posted to both accounts.");
      transferRequestKey.current = null;
      setTransferForm((form) => ({ ...form, amount_from: "", exchange_rate: "", fx_rate_to_base: "", description: "", reference: "" }));
      await invalidateAccounts();
    },
    onError: (error) => toast.error(error.message),
  });
  const reconcileTransaction = useMutation({
    mutationFn: ({ id, reconciled }: { id: number; reconciled: boolean }) =>
      reconcileAccountTransactionApi(id, reconciled),
    onSuccess: invalidateAccounts,
    onError: (error) => toast.error(error.message),
  });
  const reconcileBalance = useMutation({
    mutationFn: ({ accountId, payload }: {
      accountId: number;
      payload: { as_of: string; actual_balance: string; note?: string; post_adjustment: boolean; fx_rate_to_base?: string; idempotency_key: string };
    }) => reconcileAccountBalanceApi(accountId, payload),
    onSuccess: async (result) => {
      toast.success(result.adjustment_transaction
        ? `Count recorded and ${money(Math.abs(Number(result.difference)), selectedHistoryAccount?.currency ?? profile.currency)} adjustment posted.`
        : "Account count recorded.");
      setBalanceForm({ actual_balance: "", note: "", post_adjustment: false, fx_rate_to_base: "" });
      await invalidateAccounts();
      await queryClient.invalidateQueries({ queryKey: ["financial-account-balance", historyAccount] });
    },
    onError: (error) => toast.error(error.message),
  });
  const toggleAccount = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => updateFinancialAccountApi(id, { is_active }),
    onSuccess: invalidateAccounts,
    onError: (error) => toast.error(error.message),
  });

  const submitAccount = (event: React.FormEvent) => {
    event.preventDefault();
    createAccount.mutate({
      ...accountForm,
      currency: accountForm.currency.trim().toUpperCase(),
      opening_date: accountForm.opening_date,
      ...(accountForm.currency.trim().toUpperCase() === profile.currency.toUpperCase()
        ? {}
        : { opening_fx_rate_to_base: accountForm.opening_fx_rate_to_base }),
    });
  };
  const submitTransaction = (event: React.FormEvent) => {
    event.preventDefault();
    if (!transactionAccount) return;
    createTransaction.mutate({
      account: transactionAccount.id,
      direction: transactionForm.direction,
      amount: transactionForm.amount,
      ...(transactionAccount.currency.toUpperCase() === profile.currency.toUpperCase()
        ? {}
        : { fx_rate_to_base: transactionForm.fx_rate_to_base }),
      transaction_date: transactionForm.transaction_date,
      description: transactionForm.description.trim(),
      reference: transactionForm.reference.trim(),
      idempotency_key: transactionRequestKey.current || (transactionRequestKey.current = crypto.randomUUID()),
    });
  };
  const submitTransfer = (event: React.FormEvent) => {
    event.preventDefault();
    if (!transferSource || !transferDestination) return;
    createTransfer.mutate({
      from_account: transferSource.id,
      to_account: transferDestination.id,
      amount_from: transferForm.amount_from,
      ...(transferSource.currency.toUpperCase() === transferDestination.currency.toUpperCase()
        ? {}
        : { exchange_rate: transferForm.exchange_rate }),
      ...(transferSource.currency.toUpperCase() === profile.currency.toUpperCase()
        ? {}
        : { fx_rate_to_base: transferForm.fx_rate_to_base }),
      transaction_date: transferForm.transaction_date,
      description: transferForm.description.trim(),
      reference: transferForm.reference.trim(),
      idempotency_key: transferRequestKey.current || (transferRequestKey.current = crypto.randomUUID()),
    });
  };

  const submitBalanceReconciliation = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedHistoryAccount || !balanceForm.actual_balance) return;
    reconcileBalance.mutate({
      accountId: selectedHistoryAccount.id,
      payload: {
        as_of: balanceAsOf,
        actual_balance: balanceForm.actual_balance,
        note: balanceForm.note.trim(),
        post_adjustment: balanceForm.post_adjustment,
        ...(balanceForm.post_adjustment && selectedHistoryAccount.currency.toUpperCase() !== profile.currency.toUpperCase()
          ? { fx_rate_to_base: balanceForm.fx_rate_to_base }
          : {}),
        idempotency_key: crypto.randomUUID(),
      },
    });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold">Financial accounts</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Track balances, receipts, payments, transfers and reconciliation. Exchange rates are saved with each posted transaction.
        </p>
      </div>

      {accountsQuery.isError && <p role="alert" className="text-sm text-destructive">{accountsQuery.error.message}</p>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => (
          <Card key={account.id} className={!account.is_active ? "opacity-60" : ""}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base">{account.name}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {accountTypes.find((type) => type.value === account.account_type)?.label}
                  {account.provider_name ? ` · ${account.provider_name}` : ""}
                  {!account.is_active ? " · Inactive" : ""}
                </p>
              </div>
              <WalletCards className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{money(account.current_balance, account.currency)}</p>
              {account.currency.toUpperCase() !== profile.currency.toUpperCase() && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Base-currency carrying value: {money(account.current_balance_base, profile.currency)}
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 px-0"
                disabled={toggleAccount.isPending}
                onClick={() => toggleAccount.mutate({ id: account.id, is_active: !account.is_active })}
              >
                {account.is_active ? "Deactivate account" : "Activate account"}
              </Button>
            </CardContent>
          </Card>
        ))}
        {!accountsQuery.isLoading && accounts.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">Create an account to start recording financial activity.</CardContent>
          </Card>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Plus className="h-4 w-4" /> Add account</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={submitAccount}>
              <div><Label htmlFor="account-name">Account name</Label><Input id="account-name" value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} required /></div>
              <div>
                <Label>Account type</Label>
                <Select value={accountForm.account_type} onValueChange={(value: ApiFinancialAccount["account_type"]) => setAccountForm({ ...accountForm, account_type: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{accountTypes.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="account-provider">Provider or bank (optional)</Label><Input id="account-provider" value={accountForm.provider_name} onChange={(event) => setAccountForm({ ...accountForm, provider_name: event.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label htmlFor="account-currency">Currency</Label><Input id="account-currency" maxLength={10} value={accountForm.currency} onChange={(event) => setAccountForm({ ...accountForm, currency: event.target.value.toUpperCase() })} required /></div>
                <div><Label htmlFor="opening-balance">Opening balance</Label><Input id="opening-balance" type="number" step="0.01" value={accountForm.opening_balance} onChange={(event) => setAccountForm({ ...accountForm, opening_balance: event.target.value })} required /></div>
              </div>
              <div><Label htmlFor="opening-date">Opening date</Label><Input id="opening-date" type="date" value={accountForm.opening_date} onChange={(event) => setAccountForm({ ...accountForm, opening_date: event.target.value })} required /></div>
              {accountForm.currency.toUpperCase() !== profile.currency.toUpperCase() && (
                <div><Label htmlFor="opening-rate">Opening rate to {profile.currency}</Label><Input id="opening-rate" type="number" min="0.000001" step="0.000001" value={accountForm.opening_fx_rate_to_base} onChange={(event) => setAccountForm({ ...accountForm, opening_fx_rate_to_base: event.target.value })} required /></div>
              )}
              <Button className="w-full" disabled={createAccount.isPending}>{createAccount.isPending ? "Saving..." : "Create account"}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ArrowDownLeft className="h-4 w-4" /> Record money in or out</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={submitTransaction}>
              <div>
                <Label>Account</Label>
                <Select value={transactionForm.account} onValueChange={(value) => setTransactionForm({ ...transactionForm, account: value, fx_rate_to_base: "" })}>
                  <SelectTrigger><SelectValue placeholder="Choose an account" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Choose account</SelectItem>{activeAccounts.map((account) => <SelectItem key={account.id} value={String(account.id)}>{account.name} · {account.currency}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Activity</Label>
                <Select value={transactionForm.direction} onValueChange={(value: "in" | "out") => setTransactionForm({ ...transactionForm, direction: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="in">Money received</SelectItem><SelectItem value="out">Money paid out</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label htmlFor="transaction-amount">Amount {transactionAccount ? `(${transactionAccount.currency})` : ""}</Label><Input id="transaction-amount" type="number" min="0.01" step="0.01" value={transactionForm.amount} onChange={(event) => setTransactionForm({ ...transactionForm, amount: event.target.value })} required /></div>
                <div><Label htmlFor="transaction-date">Date</Label><Input id="transaction-date" type="date" value={transactionForm.transaction_date} onChange={(event) => setTransactionForm({ ...transactionForm, transaction_date: event.target.value })} required /></div>
              </div>
              {transactionAccount && transactionAccount.currency.toUpperCase() !== profile.currency.toUpperCase() && (
                <div><Label htmlFor="transaction-rate">Transaction rate to {profile.currency}</Label><Input id="transaction-rate" type="number" min="0.000001" step="0.000001" value={transactionForm.fx_rate_to_base} onChange={(event) => setTransactionForm({ ...transactionForm, fx_rate_to_base: event.target.value })} required /></div>
              )}
              <div><Label htmlFor="transaction-description">Description</Label><Input id="transaction-description" value={transactionForm.description} onChange={(event) => setTransactionForm({ ...transactionForm, description: event.target.value })} required /></div>
              <div><Label htmlFor="transaction-reference">Reference (optional)</Label><Input id="transaction-reference" value={transactionForm.reference} onChange={(event) => setTransactionForm({ ...transactionForm, reference: event.target.value })} /></div>
              <Button className="w-full" disabled={!transactionAccount || createTransaction.isPending}>{createTransaction.isPending ? "Posting..." : "Post transaction"}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ArrowLeftRight className="h-4 w-4" /> Transfer between accounts</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={submitTransfer}>
              <div>
                <Label>From account</Label>
                <Select value={transferForm.from_account} onValueChange={(value) => setTransferForm({ ...transferForm, from_account: value, exchange_rate: "", fx_rate_to_base: "" })}>
                  <SelectTrigger><SelectValue placeholder="Choose source" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Choose source</SelectItem>{activeAccounts.map((account) => <SelectItem key={account.id} value={String(account.id)}>{account.name} · {account.currency}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>To account</Label>
                <Select value={transferForm.to_account} onValueChange={(value) => setTransferForm({ ...transferForm, to_account: value })}>
                  <SelectTrigger><SelectValue placeholder="Choose destination" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Choose destination</SelectItem>{activeAccounts.map((account) => <SelectItem key={account.id} value={String(account.id)}>{account.name} · {account.currency}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label htmlFor="transfer-amount">Amount {transferSource ? `(${transferSource.currency})` : ""}</Label><Input id="transfer-amount" type="number" min="0.01" step="0.01" value={transferForm.amount_from} onChange={(event) => setTransferForm({ ...transferForm, amount_from: event.target.value })} required /></div>
                <div><Label htmlFor="transfer-date">Date</Label><Input id="transfer-date" type="date" value={transferForm.transaction_date} onChange={(event) => setTransferForm({ ...transferForm, transaction_date: event.target.value })} required /></div>
              </div>
              {transferSource && transferDestination && transferSource.currency.toUpperCase() !== transferDestination.currency.toUpperCase() && (
                <div><Label htmlFor="transfer-rate">Rate ({transferDestination.currency} per {transferSource.currency})</Label><Input id="transfer-rate" type="number" min="0.000001" step="0.000001" value={transferForm.exchange_rate} onChange={(event) => setTransferForm({ ...transferForm, exchange_rate: event.target.value })} required /></div>
              )}
              {transferSource && transferSource.currency.toUpperCase() !== profile.currency.toUpperCase() && (
                <div><Label htmlFor="transfer-base-rate">Source rate to {profile.currency}</Label><Input id="transfer-base-rate" type="number" min="0.000001" step="0.000001" value={transferForm.fx_rate_to_base} onChange={(event) => setTransferForm({ ...transferForm, fx_rate_to_base: event.target.value })} required /></div>
              )}
              {transferSource && transferDestination && (
                <p className="text-xs text-muted-foreground">
                  Destination receives {money(
                    (Number(transferForm.amount_from || 0) * (
                      transferSource.currency.toUpperCase() === transferDestination.currency.toUpperCase()
                        ? 1
                        : Number(transferForm.exchange_rate || 0)
                    )).toFixed(2),
                    transferDestination.currency,
                  )}
                </p>
              )}
              <div><Label htmlFor="transfer-description">Description (optional)</Label><Input id="transfer-description" value={transferForm.description} onChange={(event) => setTransferForm({ ...transferForm, description: event.target.value })} /></div>
              <div><Label htmlFor="transfer-reference">Reference (optional)</Label><Input id="transfer-reference" value={transferForm.reference} onChange={(event) => setTransferForm({ ...transferForm, reference: event.target.value })} /></div>
              <Button className="w-full" disabled={!transferSource || !transferDestination || transferSource.id === transferDestination.id || createTransfer.isPending}>{createTransfer.isPending ? "Posting..." : "Post transfer"}</Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Account history and reconciliation</CardTitle>
          <Select value={historyAccount} onValueChange={(value) => {
            setHistoryAccount(value);
            setBalanceForm({ actual_balance: "", note: "", post_adjustment: false, fx_rate_to_base: "" });
          }}>
            <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All accounts</SelectItem>{accounts.map((account) => <SelectItem key={account.id} value={String(account.id)}>{account.name}</SelectItem>)}</SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {historyAccount !== "all" && (
            <>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-lg bg-muted/40 p-3">
                <div>
                  <Label htmlFor="closing-balance-date">Closing balance as of</Label>
                  <Input
                    id="closing-balance-date"
                    type="date"
                    value={balanceAsOf}
                    onChange={(event) => setBalanceAsOf(event.target.value)}
                    className="mt-1 w-52"
                  />
                </div>
                {closingBalanceQuery.isError ? (
                  <p role="alert" className="text-sm text-destructive">{closingBalanceQuery.error.message}</p>
                ) : closingBalanceQuery.data ? (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Expected closing balance</p>
                    <p className="font-semibold">
                      {money(closingBalanceQuery.data.balance, selectedHistoryAccount?.currency ?? profile.currency)}
                    </p>
                    {selectedHistoryAccount?.currency.toUpperCase() !== profile.currency.toUpperCase() && (
                      <p className="text-xs text-muted-foreground">
                        Carrying value: {money(closingBalanceQuery.data.balance_base, profile.currency)}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Calculating closing balance...</p>
                )}
              </div>
              <form onSubmit={submitBalanceReconciliation} className="mb-4 space-y-3 rounded-lg border border-border p-3">
                <div>
                  <h3 className="text-sm font-semibold">Reconcile actual balance</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Compare the expected balance with your till count or bank statement.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="actual-account-balance">Counted balance ({selectedHistoryAccount?.currency})</Label>
                    <Input id="actual-account-balance" type="number" step="0.01" value={balanceForm.actual_balance} onChange={(event) => setBalanceForm({ ...balanceForm, actual_balance: event.target.value })} required />
                  </div>
                  <div>
                    <Label htmlFor="reconciliation-note">Note (optional)</Label>
                    <Input id="reconciliation-note" maxLength={255} value={balanceForm.note} onChange={(event) => setBalanceForm({ ...balanceForm, note: event.target.value })} placeholder="Count, statement date, or reason" />
                  </div>
                </div>
                {balanceForm.post_adjustment && selectedHistoryAccount && selectedHistoryAccount.currency.toUpperCase() !== profile.currency.toUpperCase() ? (
                  <div>
                    <Label htmlFor="reconciliation-rate">Adjustment rate to {profile.currency}</Label>
                    <Input id="reconciliation-rate" type="number" min="0.000001" step="0.000001" value={balanceForm.fx_rate_to_base} onChange={(event) => setBalanceForm({ ...balanceForm, fx_rate_to_base: event.target.value })} required />
                  </div>
                ) : null}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={balanceForm.post_adjustment} onChange={(event) => setBalanceForm({ ...balanceForm, post_adjustment: event.target.checked, fx_rate_to_base: "" })} className="mt-1" />
                  <span>Post the difference as a traceable financial adjustment.</span>
                </label>
                <Button type="submit" disabled={!selectedHistoryAccount || !balanceForm.actual_balance || reconcileBalance.isPending}>
                  {reconcileBalance.isPending ? "Saving count..." : "Save reconciliation"}
                </Button>
              </form>
              {closingBalanceQuery.data?.reconciliation_history?.length ? (
                <div className="mb-4 rounded-lg border border-border p-3">
                  <h3 className="text-sm font-semibold">Reconciliation history</h3>
                  <div className="mt-2 space-y-2">
                    {closingBalanceQuery.data.reconciliation_history.map((entry) => (
                      <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs">
                        <div><span className="font-medium">{entry.as_of}</span>{entry.note ? <span className="text-muted-foreground"> · {entry.note}</span> : null}</div>
                        <div className="text-right">
                          Expected {money(entry.expected_balance, selectedHistoryAccount?.currency ?? profile.currency)} · Counted {money(entry.actual_balance, selectedHistoryAccount?.currency ?? profile.currency)} · Difference {money(entry.difference, selectedHistoryAccount?.currency ?? profile.currency)}
                          {entry.adjustment_transaction ? <span className="ml-2 font-medium text-emerald-700">Adjustment posted</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
          {transactionsQuery.isError && <p role="alert" className="mb-3 text-sm text-destructive">{transactionsQuery.error.message}</p>}
          {transactionsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading account history...</p> : transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No account transactions recorded yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Account</TableHead><TableHead>Description</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {transactions.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.transaction_date}</TableCell>
                    <TableCell>{entry.account_name}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        {entry.direction === "in" ? <ArrowDownLeft className="h-4 w-4 text-emerald-600" /> : <ArrowUpRight className="h-4 w-4 text-rose-600" />}
                        {entry.description}
                        {entry.entry_type.startsWith("transfer") && <span className="text-xs text-muted-foreground">Transfer</span>}
                      </span>
                    </TableCell>
                    <TableCell>{entry.reference || "—"}</TableCell>
                    <TableCell className="text-right">{entry.direction === "out" ? "−" : "+"}{money(entry.amount, entry.currency)}</TableCell>
                    <TableCell>{entry.is_reconciled ? <span className="inline-flex items-center gap-1 text-emerald-700"><Check className="h-3.5 w-3.5" /> Reconciled</span> : "Unreconciled"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reconcileTransaction.isPending}
                        onClick={() => reconcileTransaction.mutate({ id: entry.id, reconciled: !entry.is_reconciled })}
                      >
                        {entry.is_reconciled ? "Undo" : "Reconcile"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FinancialAccounts;
