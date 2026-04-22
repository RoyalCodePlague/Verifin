const BARCODE_CACHE_KEY = "sp_barcode_lookup_cache";

export type BarcodeCacheEntry = {
  barcode: string;
  name: string;
  brand?: string;
  category?: string;
  source?: string;
  cachedAt: number;
};

function readCache(): Record<string, BarcodeCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(BARCODE_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, BarcodeCacheEntry>) {
  localStorage.setItem(BARCODE_CACHE_KEY, JSON.stringify(cache));
}

export function getCachedBarcodeEntry(barcode: string): BarcodeCacheEntry | null {
  const normalized = barcode.trim();
  if (!normalized) return null;
  return readCache()[normalized] || null;
}

export function cacheBarcodeEntry(entry: Omit<BarcodeCacheEntry, "cachedAt">) {
  const normalized = entry.barcode.trim();
  if (!normalized || !entry.name.trim()) return;
  const cache = readCache();
  cache[normalized] = {
    ...entry,
    barcode: normalized,
    cachedAt: Date.now(),
  };
  writeCache(cache);
}
