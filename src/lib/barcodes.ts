function compactBarcode(value: string) {
  return value.trim().replace(/[\s-]+/g, "");
}

export function normalizeBarcode(value: string) {
  return compactBarcode(value);
}

export function barcodeVariants(value: string) {
  const normalized = compactBarcode(value);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);

  const digitsOnly = normalized.replace(/\D+/g, "");
  if (digitsOnly) {
    variants.add(digitsOnly);

    // Some scanners return UPC-A as EAN-13 with a leading zero.
    if (digitsOnly.length === 12) {
      variants.add(`0${digitsOnly}`);
    }
    if (digitsOnly.length === 13 && digitsOnly.startsWith("0")) {
      variants.add(digitsOnly.slice(1));
    }
  }

  return Array.from(variants);
}

export function barcodeMatches(left?: string | null, right?: string | null) {
  if (!left || !right) return false;

  const leftVariants = new Set(barcodeVariants(left));
  return barcodeVariants(right).some((variant) => leftVariants.has(variant));
}
