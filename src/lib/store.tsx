import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  stock: number;
  reorder: number;
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
  time: string;
  date: string;
  method: "Cash" | "EFT" | "Card";
  customerId?: string;
  saleItems?: SaleItem[];
}

export interface Expense {
  id: string;
  desc: string;
  amount: number;
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
}

export interface BusinessProfile {
  name: string;
  currency: string;
  currencySymbol: string;
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
  activities: ActivityItem[];
  setProfile: (p: BusinessProfile) => void;
  addProduct: (p: Omit<Product, "id" | "status">) => void;
  updateProduct: (id: string, p: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  addSale: (s: Omit<Sale, "id">) => void;
  deleteSale: (id: string) => void;
  addExpense: (e: Omit<Expense, "id">) => void;
  deleteExpense: (id: string) => void;
  addCustomer: (c: Omit<Customer, "id">) => void;
  updateCustomer: (id: string, c: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;
  addStaff: (s: Omit<StaffMember, "id">) => void;
  updateStaff: (id: string, s: Partial<StaffMember>) => void;
  deleteStaff: (id: string) => void;
  addActivity: (a: Omit<ActivityItem, "id">) => void;
  resolveDiscrepancy: (id: string) => void;
  addAudit: (a: Omit<AuditRecord, "id">) => string;
  updateAudit: (id: string, a: Partial<AuditRecord>) => void;
  addDiscrepancy: (d: Omit<Discrepancy, "id">) => void;
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
  }) => void;
  resetForLogout: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const defaultProfile: BusinessProfile = {
  name: "",
  currency: "ZAR",
  currencySymbol: "R",
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
  useEffect(() => saveState("activities", activities), [activities]);

  const setProfile = useCallback((p: BusinessProfile) => setProfileState(p), []);
  
  const addProduct = useCallback((p: Omit<Product, "id" | "status">) => {
    const product: Product = { ...p, id: uid(), status: computeStatus(p.stock, p.reorder), addedDate: p.addedDate || today(), lastRestocked: p.lastRestocked || today() };
    setProducts(prev => [product, ...prev]);
    addActivity({ text: `Added product: ${p.name}`, time: "Just now", type: "restock" });
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
    setSales(prev => [{ ...s, id: uid() }, ...prev]);
    
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

  const deleteSale = useCallback((id: string) => setSales(prev => prev.filter(s => s.id !== id)), []);

  const addExpense = useCallback((e: Omit<Expense, "id">) => {
    setExpenses(prev => [{ ...e, id: uid() }, ...prev]);
    addActivity({ text: `Expense: ${e.desc} — ${e.amount.toLocaleString()}`, time: "Just now", type: "expense" });
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

  const addActivity = useCallback((a: Omit<ActivityItem, "id">) => {
    setActivities(prev => [{ ...a, id: uid() }, ...prev].slice(0, 50));
  }, []);

  const resolveDiscrepancy = useCallback((id: string) => {
    setDiscrepancies(prev => prev.map(d => d.id === id ? { ...d, status: "resolved" as const } : d));
  }, []);

  const addAudit = useCallback((a: Omit<AuditRecord, "id">) => {
    const id = uid();
    setAudits(prev => [{ ...a, id }, ...prev]);
    return id;
  }, []);

  const updateAudit = useCallback((id: string, updates: Partial<AuditRecord>) => {
    setAudits(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  const addDiscrepancy = useCallback((d: Omit<Discrepancy, "id">) => {
    setDiscrepancies(prev => [{ ...d, id: uid() }, ...prev]);
  }, []);

  const generateWhatsAppSummary = useCallback(() => {
    const sym = profile.currencySymbol || "R";
    const todaySales = sales.filter(s => s.date === "Today");
    const todayTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
    const todayExpenses = expenses.filter(e => e.date === "Today").reduce((sum, e) => sum + e.amount, 0);
    const lowStock = products.filter(p => p.status === "low" || p.status === "out");
    const invValue = products.reduce((sum, p) => sum + p.stock * p.price, 0);

    let msg = `*Verifin Daily Summary*\n`;
    msg += `${new Date().toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}\n\n`;
    msg += `*Sales:* ${sym}${todayTotal.toLocaleString()} (${todaySales.length} transactions)\n`;
    msg += `*Expenses:* ${sym}${todayExpenses.toLocaleString()}\n`;
    msg += `*Net:* ${sym}${(todayTotal - todayExpenses).toLocaleString()}\n`;
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
    }) => {
      setProfileState(data.profile);
      setProducts(data.products);
      setSales(data.sales);
      setExpenses(data.expenses);
      setAudits(data.audits);
      setDiscrepancies(data.discrepancies);
      setCustomers(data.customers);
      setStaff(data.staff);
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
    setActivities([]);
    ["profile", "products", "sales", "expenses", "audits", "discrepancies", "customers", "staff", "activities"].forEach((key) => {
      localStorage.removeItem(`sp_${key}`);
    });
  }, []);

  return (
    <StoreContext.Provider value={{
      profile, products, sales, expenses, audits, discrepancies, customers, staff, activities,
      setProfile, addProduct, updateProduct, deleteProduct,
      addSale, deleteSale, addExpense, deleteExpense,
      addCustomer, updateCustomer, deleteCustomer, addStaff, updateStaff, deleteStaff,
      addActivity, resolveDiscrepancy, addAudit, updateAudit, addDiscrepancy, generateWhatsAppSummary,
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
