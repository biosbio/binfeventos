export function getCountryOptions(locale = "pt-PT"): { code: string; name: string }[] {
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  const options: { code: string; name: string }[] = [];

  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      const name = displayNames.of(code);
      if (name && name !== code && code !== "ZZ" && !name.toLowerCase().includes("desconhecida")) {
        options.push({ code, name });
      }
    }
  }

  return options.sort((a, b) => a.name.localeCompare(b.name, locale));
}

export function getCurrencyOptions(locale = "pt-PT"): { code: string; name: string }[] {
  const displayNames = new Intl.DisplayNames([locale], { type: "currency" });
  return Intl.supportedValuesOf("currency")
    .map((code) => ({ code, name: displayNames.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}
