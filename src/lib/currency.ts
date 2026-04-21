export const currencyOptions = [
  { code: "ZAR", symbol: "R", label: "South African Rand (R)" },
  { code: "USD", symbol: "$", label: "US Dollar ($)" },
  { code: "ZWL", symbol: "ZWL", label: "Zimbabwean Dollar (ZWL)" },
  { code: "ZWG", symbol: "ZiG", label: "Zimbabwe Gold (ZiG)" },
  { code: "KES", symbol: "KSh", label: "Kenyan Shilling (KSh)" },
  { code: "NGN", symbol: "NGN", label: "Nigerian Naira (NGN)" },
  { code: "GHS", symbol: "GHS", label: "Ghanaian Cedi (GHS)" },
  { code: "BWP", symbol: "P", label: "Botswana Pula (P)" },
  { code: "TZS", symbol: "TSh", label: "Tanzanian Shilling (TSh)" },
  { code: "ZMW", symbol: "K", label: "Zambian Kwacha (K)" },
  { code: "EUR", symbol: "EUR", label: "Euro (EUR)" },
  { code: "GBP", symbol: "GBP", label: "British Pound (GBP)" },
] as const;

export function symbolForCurrency(code: string) {
  return currencyOptions.find((currency) => currency.code === code)?.symbol || code;
}

const TIMEZONE_COUNTRY: Record<string, string> = {
  "Africa/Blantyre": "ZW",
  "Africa/Bujumbura": "TZ",
  "Africa/Dar_es_Salaam": "TZ",
  "Africa/Gaborone": "BW",
  "Africa/Harare": "ZW",
  "Africa/Johannesburg": "ZA",
  "Africa/Lagos": "NG",
  "Africa/Lusaka": "ZM",
  "Africa/Nairobi": "KE",
  "Africa/Windhoek": "ZA",
};

const SUPPORTED_PRICING_COUNTRIES = new Set(["ZA", "ZW", "BW", "KE", "NG", "GH", "TZ", "ZM"]);

export function getDetectedCountryCode(): string {
  const languageRegion = navigator.languages
    ?.map((language) => {
      try {
        return new Intl.Locale(language).region;
      } catch {
        return "";
      }
    })
    .find(Boolean);

  const region = (languageRegion || "").toUpperCase();
  if (SUPPORTED_PRICING_COUNTRIES.has(region)) return region;

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezoneCountry = TIMEZONE_COUNTRY[timezone];
  return SUPPORTED_PRICING_COUNTRIES.has(timezoneCountry) ? timezoneCountry : "ZA";
}

export function getRegionalCurrencyDefaults(countryCode = getDetectedCountryCode()) {
  const normalized = countryCode.trim().toUpperCase();
  switch (normalized) {
    case "ZW":
      return { baseCurrency: "USD", secondaryCurrency: "" };
    case "BW":
      return { baseCurrency: "BWP", secondaryCurrency: "" };
    case "KE":
      return { baseCurrency: "KES", secondaryCurrency: "" };
    case "NG":
      return { baseCurrency: "NGN", secondaryCurrency: "" };
    case "GH":
      return { baseCurrency: "GHS", secondaryCurrency: "" };
    case "TZ":
      return { baseCurrency: "TZS", secondaryCurrency: "" };
    case "ZM":
      return { baseCurrency: "ZMW", secondaryCurrency: "" };
    case "ZA":
    default:
      return { baseCurrency: "ZAR", secondaryCurrency: "" };
  }
}
