import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  branchId?: string;
  branchName?: string;
  supplierId?: string;
  supplierName?: string;
  stock: number;
  reorder: number;
  costPrice: number;
  costCurrency?: string;
  costFxRateToBase?: number;
  price: number;
  status: "ok" | "low" | "out";
  barcode?: string;
  addedDate?: string;
  lastRestocked?: string;
}

export interface SaleItem {
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface Sale {
  id: string;
  items: string;
  total: number;
  totalCost?: number;
  grossProfit?: number;
  time: string;
  date: string;
  method: "Cash" | "EFT" | "Card";
  paymentCurrency?: string;
  paymentAllocations?: Array<{ currency: string; amount: number; amountBase?: number }>;
  branchId?: string;
  customerId?: string;
  saleItems?: SaleItem[];
}

export interface Expense {
  id: string;
  desc: string;
  amount: number;
  currency?: string;
  amountBase?: number;
  paymentAllocations?: Array<{ currency: string; amount: number; amountBase?: number }>;
  date: string;
  category: string;
}

export interface AuditRecord {
  id: string;
  date: string;
  status: "in_progress" | "completed";
  items: number;
  discrepancies: number;
  conductor: string;
  autoFindings?: string[];
}

export interface Discrepancy {
  id: string;
  auditId?: string;
  product: string;
  expected: number;
  actual: number;
  diff: number;
  status: "unresolved" | "investigating" | "resolved";
}

export type CustomerBadge = "bronze" | "silver" | "gold" | "platinum";

export interface Customer {
  id: string;
  name: string;
  phone: string;
  totalSpent: number;
  visits: number;
  loyaltyPoints: number;
  qrCode: string;
  credits: number;
  lastVisit: string;
  badge: CustomerBadge;
}

export interface StaffMember {
  id: string;
  name: string;
  role: "Owner" | "Cashier" | "Stock Manager" | "Manager";
  status: "Active" | "Inactive";
  lastActive: string;
  branchId?: string;
  branchName?: string;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  phone: string;
  address: string;
  isPrimary: boolean;
}

export interface BusinessProfile {
  name: string;
  currency: string;
  currencySymbol: string;
  enabledCurrencies: string[];
  exchangeRates: Record<string, number>;
  categories: string[];
  whatsappDaily: boolean;
  lowStockAlerts: boolean;
  discrepancyAlerts: boolean;
  onboardingComplete: boolean;
  darkMode: boolean;
}

export interface ActivityItem {
  id: string;
  text: string;
  time: string;
  timestamp?: string;
  type: "sale" | "restock" | "expense" | "alert";
}

interface StoreState {
  profile: BusinessProfile;
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  audits: AuditRecord[];
  discrepancies: Discrepancy[];
  customers: Customer[];
  staff: StaffMember[];
  branches: Branch[];
  activities: ActivityItem[];
  setProfile: (p: BusinessProfile) => void;
  addProduct: (p: Omit<Product, "id" | "status">) => string;
  upsertProduct: (product: Product) => void;
  updateProduct: (id: string, p: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  addSale: (s: Omit<Sale, "id">) => void;
  upsertSale: (sale: Sale) => void;
  deleteSale: (id: string) => void;
  addExpense: (e: Omit<Expense, "id">) => void;
  upsertExpense: (expense: Expense) => void;
  deleteExpense: (id: string) => void;
  addCustomer: (c: Omit<Customer, "id">) => void;
  updateCustomer: (id: string, c: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;
  addStaff: (s: Omit<StaffMember, "id">) => void;
  updateStaff: (id: string, s: Partial<StaffMember>) => void;
  deleteStaff: (id: string) => void;
  addBranch: (b: Omit<Branch, "id">) => string;
  updateBranch: (id: string, b: Partial<Branch>) => void;
  deleteBranch: (id: string) => void;
  addActivity: (a: Omit<ActivityItem, "id">) => void;
  resolveDiscrepancy: (id: string) => void;
  addAudit: (a: Omit<AuditRecord, "id">) => string;
  upsertAudit: (audit: AuditRecord) => void;
  updateAudit: (id: string, a: Partial<AuditRecord>) => void;
  addDiscrepancy: (d: Omit<Discrepancy, "id">) => void;
  upsertDiscrepancy: (discrepancy: Discrepancy) => void;
  generateWhatsAppSummary: () => string;
  hydrateFromServer: (data: {
    profile: BusinessProfile;
    products: Product[];
    sales: Sale[];
    expenses: Expense[];
    audits: AuditRecord[];
    discrepancies: Discrepancy[];
    customers: Customer[];
    staff: StaffMember[];
    branches: Branch[];
  }) => void;
  resetForLogout: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const defaultProfile: BusinessProfile = {
  name: "",
  currency: "ZAR",
  currencySymbol: "R",
  enabledCurrencies: ["ZAR"],
  exchangeRates: {},
  categories: ["Groceries", "Beverages", "Hardware", "Personal Care"],
  whatsappDaily: true,
  lowStockAlerts: true,
  discrepancyAlerts: true,
  onboardingComplete: false,
  darkMode: false,
};

function loadState<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(`sp_${key}`);
    return stored ? JSON.parse(stored) : fallback;
  } catch { return fallback; }
}

function saveState(key: string, value: unknown) {
  localStorage.setItem(`sp_${key}`, JSON.stringify(value));
}

function computeStatus(stock: number, reorder: number): "ok" | "low" | "out" {
  if (stock <= 0) return "out";
  if (stock <= reorder) return "low";
  return "ok";
}

const StoreContext = createContext<StoreState | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<BusinessProfile>(() => loadState("profile", defaultProfile));
  const [products, setProducts] = useState<Product[]>(() => loadState("products", []));
  const [sales, setSales] = useState<Sale[]>(() => loadState("sales", []));
  const [expenses, setExpenses] = useState<Expense[]>(() => loadState("expenses", []));
  const [audits, setAudits] = useState<AuditRecord[]>(() => loadState("audits", []));
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>(() => loadState("discrepancies", []));
  const [customers, setCustomers] = useState<Customer[]>(() => loadState("customers", []));
  const [staff, setStaff] = useState<StaffMember[]>(() => loadState("staff", []));
  const [branches, setBranches] = useState<Branch[]>(() => loadState("branches", []));
  const [activities, setActivities] = useState<ActivityItem[]>(() => loadState("activities", []));

  useEffect(() => {
    if (profile.darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [profile.darkMode]);

  useEffect(() => saveState("profile", profile), [profile]);
  useEffect(() => saveState("products", products), [products]);
  useEffect(() => saveState("sales", sales), [sales]);
  useEffect(() => saveState("expenses", expenses), [expenses]);
  useEffect(() => saveState("audits", audits), [audits]);
  useEffect(() => saveState("discrepancies", discrepancies), [discrepancies]);
  useEffect(() => saveState("customers", customers), [customers]);
  useEffect(() => saveState("staff", staff), [staff]);
  useEffect(() => saveState("branches", branches), [branches]);
  useEffect(() => saveState("activities", activities), [activities]);

  const setProfile = useCallback((p: BusinessProfile) => setProfileState(p), []);
  
  const addProduct = useCallback((p: Omit<Product, "id" | "status">) => {
    const id = uid();
    const product: Product = { ...p, id, status: computeStatus(p.stock, p.reorder), addedDate: p.addedDate || today(), lastRestocked: p.lastRestocked || today() };
    setProducts(prev => [product, ...prev]);
    addActivity({ text: `Added product: ${p.name}`, time: "Just now", type: "restock" });
    return id;
  }, []);

  const upsertProduct = useCallback((product: Product) => {
    setProducts(prev => {
      const next = {
        ...product,
        status: computeStatus(product.stock, product.reorder),
        addedDate: product.addedDate || today(),
        lastRestocked: product.lastRestocked || today(),
      };
      const existingIndex = prev.findIndex((item) => item.id === next.id);
      if (existingIndex === -1) {
        return [next, ...prev];
      }
      const updated = [...prev];
      updated[existingIndex] = next;
      return updated;
    });
  }, []);

  const updateProduct = useCallback((id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, ...updates };
      if (updates.stock !== undefined && updates.stock > p.stock) {
        updated.lastRestocked = today();
      }
      updated.status = computeStatus(updated.stock, updated.reorder);
      return updated;
    }));
  }, []);

  const deleteProduct = useCallback((id: string) => setProducts(prev => prev.filter(p => p.id !== id)), []);

  const addSale = useCallback((s: Omit<Sale, "id">) => {
    const totalCost = s.saleItems?.reduce((sum, item) => {
      const product = products.find(p => p.name.toLowerCase() === item.productName.toLowerCase());
      return sum + ((product?.costPrice || 0) * item.quantity);
    }, 0) || s.totalCost || 0;
    setSales(prev => [{ ...s, id: uid(), totalCost, grossProfit: s.total - totalCost }, ...prev]);
    
    // Subtract sold items from inventory
    if (s.saleItems && s.saleItems.length > 0) {
      setProducts(prev => {
        const updated = [...prev];
        for (const item of s.saleItems!) {
          const idx = updated.findIndex(p => p.name.toLowerCase() === item.productName.toLowerCase());
          if (idx >= 0) {
            const newStock = Math.max(0, updated[idx].stock - item.quantity);
            updated[idx] = {
              ...updated[idx],
              stock: newStock,
              status: computeStatus(newStock, updated[idx].reorder),
            };
          }
        }
        return updated;
      });
    }

    if (s.customerId) {
      setCustomers(prev => prev.map(c => 
        c.id === s.customerId ? { 
          ...c, 
          totalSpent: c.totalSpent + s.total, 
          visits: c.visits + 1, 
          loyaltyPoints: c.loyaltyPoints + Math.floor(s.total / 10),
          lastVisit: "Today" 
        } : c
      ));
    }
    addActivity({ text: `Sold ${s.items} — ${s.total.toLocaleString()}`, time: "Just now", type: "sale" });
  }, []);

  const upsertSale = useCallback((sale: Sale) => {
    setSales(prev => {
      const existingIndex = prev.findIndex((item) => item.id === sale.id);
      if (existingIndex === -1) {
        return [sale, ...prev];
      }
      const updated = [...prev];
      updated[existingIndex] = sale;
      return updated;
    });
  }, []);

  const deleteSale = useCallback((id: string) => setSales(prev => prev.filter(s => s.id !== id)), []);

  const addExpense = useCallback((e: Omit<Expense, "id">) => {
    setExpenses(prev => [{ ...e, id: uid() }, ...prev]);
    addActivity({ text: `Expense: ${e.desc} — ${e.amount.toLocaleString()}`, time: "Just now", type: "expense" });
  }, []);

  const upsertExpense = useCallback((expense: Expense) => {
    setExpenses(prev => {
      const existingIndex = prev.findIndex((item) => item.id === expense.id);
      if (existingIndex === -1) {
        return [expense, ...prev];
      }
      const updated = [...prev];
      updated[existingIndex] = expense;
      return updated;
    });
  }, []);

  const deleteExpense = useCallback((id: string) => setExpenses(prev => prev.filter(e => e.id !== id)), []);

  const addCustomer = useCallback((c: Omit<Customer, "id">) => setCustomers(prev => [{ ...c, id: uid() }, ...prev]), []);
  const updateCustomer = useCallback((id: string, updates: Partial<Customer>) => {
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }, []);
  const deleteCustomer = useCallback((id: string) => setCustomers(prev => prev.filter(c => c.id !== id)), []);

  const addStaff = useCallback((s: Omit<StaffMember, "id">) => setStaff(prev => [{ ...s, id: uid() }, ...prev]), []);
  const updateStaff = useCallback((id: string, updates: Partial<StaffMember>) => {
    setStaff(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);
  const deleteStaff = useCallback((id: string) => setStaff(prev => prev.filter(s => s.id !== id)), []);

  const addBranch = useCallback((b: Omit<Branch, "id">) => {
    const id = uid();
    setBranches(prev => [{ ...b, id }, ...prev.map(branch => b.isPrimary ? { ...branch, isPrimary: false } : branch)]);
    return id;
  }, [products]);

  const updateBranch = useCallback((id: string, updates: Partial<Branch>) => {
    setBranches(prev => prev.map(branch => {
      if (branch.id === id) return { ...branch, ...updates };
      if (updates.isPrimary) return { ...branch, isPrimary: false };
      return branch;
    }));
  }, []);

  const deleteBranch = useCallback((id: string) => setBranches(prev => prev.filter(b => b.id !== id)), []);

  const addActivity = useCallback((a: Omit<ActivityItem, "id">) => {
    setActivities(prev => [{
      ...a,
      id: uid(),
      time: a.time || "Just now",
      timestamp: a.timestamp || new Date().toISOString(),
    }, ...prev].slice(0, 50));
  }, []);

  const resolveDiscrepancy = useCallback((id: string) => {
    setDiscrepancies(prev => prev.map(d => d.id === id ? { ...d, status: "resolved" as const } : d));
  }, []);

  const addAudit = useCallback((a: Omit<AuditRecord, "id">) => {
    const id = uid();
    setAudits(prev => [{ ...a, id }, ...prev]);
    return id;
  }, []);

  const upsertAudit = useCallback((audit: AuditRecord) => {
    setAudits(prev => {
      const existingIndex = prev.findIndex((item) => item.id === audit.id);
      if (existingIndex === -1) {
        return [audit, ...prev];
      }
      const updated = [...prev];
      updated[existingIndex] = audit;
      return updated;
    });
  }, []);

  const updateAudit = useCallback((id: string, updates: Partial<AuditRecord>) => {
    setAudits(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  const addDiscrepancy = useCallback((d: Omit<Discrepancy, "id">) => {
    setDiscrepancies(prev => [{ ...d, id: uid() }, ...prev]);
  }, []);

  const upsertDiscrepancy = useCallback((discrepancy: Discrepancy) => {
    setDiscrepancies(prev => {
      const existingIndex = prev.findIndex((item) => item.id === discrepancy.id);
      if (existingIndex === -1) {
        return [discrepancy, ...prev];
      }
      const updated = [...prev];
      updated[existingIndex] = discrepancy;
      return updated;
    });
  }, []);

  const generateWhatsAppSummary = useCallback(() => {
    const sym = profile.currencySymbol || "R";
    const todaySales = sales.filter(s => s.date === "Today");
    const todayTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
    const todayExpenses = expenses.filter(e => e.date === "Today").reduce((sum, e) => sum + e.amount, 0);
    const lowStock = products.filter(p => p.status === "low" || p.status === "out");
    const invValue = products.reduce((sum, p) => sum + p.stock * p.price, 0);
    const invCost = products.reduce((sum, p) => sum + p.stock * (p.costPrice || 0), 0);

    let msg = `*Verifin Daily Summary*\n`;
    msg += `${new Date().toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}\n\n`;
    msg += `*Sales:* ${sym}${todayTotal.toLocaleString()} (${todaySales.length} transactions)\n`;
    msg += `*Expenses:* ${sym}${todayExpenses.toLocaleString()}\n`;
    msg += `*Net:* ${sym}${(todayTotal - todayExpenses).toLocaleString()}\n`;
    msg += `*Inventory Cost:* ${sym}${invCost.toLocaleString()}\n`;
    msg += `*Inventory Value:* ${sym}${invValue.toLocaleString()}\n\n`;
    if (lowStock.length > 0) {
      msg += `*Low Stock Alerts:*\n`;
      lowStock.forEach(p => { msg += `- ${p.name}: ${p.stock} left\n`; });
    }
    msg += `\n_Sent from Verifin_`;
    return msg;
  }, [sales, expenses, products, profile]);

  const hydrateFromServer = useCallback(
    (data: {
      profile: BusinessProfile;
      products: Product[];
      sales: Sale[];
      expenses: Expense[];
      audits: AuditRecord[];
      discrepancies: Discrepancy[];
      customers: Customer[];
      staff: StaffMember[];
      branches: Branch[];
    }) => {
      setProfileState(data.profile);
      setProducts(data.products);
      setSales(data.sales);
      setExpenses(data.expenses);
      setAudits(data.audits);
      setDiscrepancies(data.discrepancies);
      setCustomers(data.customers);
      setStaff(data.staff);
      setBranches(data.branches);
    },
    []
  );

  const resetForLogout = useCallback(() => {
    setProfileState(defaultProfile);
    setProducts([]);
    setSales([]);
    setExpenses([]);
    setAudits([]);
    setDiscrepancies([]);
    setCustomers([]);
    setStaff([]);
    setBranches([]);
    setActivities([]);
    ["profile", "products", "sales", "expenses", "audits", "discrepancies", "customers", "staff", "branches", "activities"].forEach((key) => {
      localStorage.removeItem(`sp_${key}`);
    });
  }, []);

  return (
    <StoreContext.Provider value={{
      profile, products, sales, expenses, audits, discrepancies, customers, staff, branches, activities,
      setProfile, addProduct, upsertProduct, updateProduct, deleteProduct,
      addSale, upsertSale, deleteSale, addExpense, upsertExpense, deleteExpense,
      addCustomer, updateCustomer, deleteCustomer, addStaff, updateStaff, deleteStaff,
      addBranch, updateBranch, deleteBranch, addActivity, resolveDiscrepancy, addAudit, upsertAudit, updateAudit, addDiscrepancy, upsertDiscrepancy, generateWhatsAppSummary,
      hydrateFromServer, resetForLogout,
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
