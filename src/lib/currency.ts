export const currencyOptions = [
  { code: "ZAR", symbol: "R", label: "South African Rand (R)" },
  { code: "USD", symbol: "$", label: "US Dollar ($)" },
  { code: "ZWL", symbol: "ZWL", label: "Zimbabwean Dollar (ZWL)" },
  { code: "ZWG", symbol: "ZiG", label: "Zimbabwe Gold (ZiG)" },
  { code: "KES", symbol: "KSh", label: "Kenyan Shilling (KSh)" },
  { code: "NGN", symbol: "NGN", label: "Nigerian Naira (NGN)" },
  { code: "GHS", symbol: "GHS", label: "Ghanaian Cedi (GHS)" },
  { code: "BWP", symbol: "P", label: "Botswana Pula (P)" },
  { code: "EUR", symbol: "EUR", label: "Euro (EUR)" },
  { code: "GBP", symbol: "GBP", label: "British Pound (GBP)" },
] as const;

export function symbolForCurrency(code: string) {
  return currencyOptions.find((currency) => currency.code === code)?.symbol || code;
}
