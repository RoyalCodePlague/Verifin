COUNTRY_PRICING = {
    "ZA": {
        "country_name": "South Africa",
        "currency": "ZAR",
        "symbol": "R",
        "starter": (0, 0),
        "growth": (299, 2990),
        "business": (599, 5990),
    },
    "ZW": {
        "country_name": "Zimbabwe",
        "currency": "USD",
        "symbol": "$",
        "starter": (0, 0),
        "growth": (12, 120),
        "business": (24, 240),
    },
    "BW": {
        "country_name": "Botswana",
        "currency": "BWP",
        "symbol": "P",
        "starter": (0, 0),
        "growth": (220, 2200),
        "business": (440, 4400),
    },
    "KE": {
        "country_name": "Kenya",
        "currency": "KES",
        "symbol": "KSh",
        "starter": (0, 0),
        "growth": (1800, 18000),
        "business": (3600, 36000),
    },
    "NG": {
        "country_name": "Nigeria",
        "currency": "NGN",
        "symbol": "NGN",
        "starter": (0, 0),
        "growth": (18000, 180000),
        "business": (36000, 360000),
    },
    "GH": {
        "country_name": "Ghana",
        "currency": "GHS",
        "symbol": "GHc",
        "starter": (0, 0),
        "growth": (180, 1800),
        "business": (360, 3600),
    },
    "TZ": {
        "country_name": "Tanzania",
        "currency": "TZS",
        "symbol": "TSh",
        "starter": (0, 0),
        "growth": (30000, 300000),
        "business": (60000, 600000),
    },
    "ZM": {
        "country_name": "Zambia",
        "currency": "ZMW",
        "symbol": "K",
        "starter": (0, 0),
        "growth": (300, 3000),
        "business": (600, 6000),
    },
}

DEFAULT_COUNTRY = "ZA"


def normalize_country_code(value):
    code = (value or "").strip().upper()
    return code if len(code) == 2 and code.isalpha() else ""
