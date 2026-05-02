const ICON_FOLDERS = {
  light: "favicomatic-LIGHT",
  dark: "favicomatic-DARK",
} as const;

type IconMode = keyof typeof ICON_FOLDERS;

function modeFromStorage(): IconMode | null {
  try {
    const storedProfile = localStorage.getItem("sp_profile");
    if (!storedProfile) return null;
    const profile = JSON.parse(storedProfile) as { darkMode?: boolean };
    return profile.darkMode ? "dark" : "light";
  } catch {
    return null;
  }
}

function modeFromDocument(): IconMode {
  if (document.documentElement.classList.contains("dark")) return "dark";
  return modeFromStorage() || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function applyAppIcons(mode: IconMode) {
  const folder = ICON_FOLDERS[mode];
  const manifest = document.getElementById("app-manifest") as HTMLLinkElement | null;
  if (manifest) manifest.href = mode === "dark" ? "/manifest-dark.json" : "/manifest-light.json";

  document.querySelectorAll<HTMLLinkElement>("link[data-icon-size]").forEach((link) => {
    const size = link.dataset.iconSize;
    if (!size) return;
    link.href = size === "ico" ? `/${folder}/favicon.ico` : `/${folder}/favicon-${size}.png`;
  });

  document.querySelectorAll<HTMLLinkElement>("link[data-apple-icon-size]").forEach((link) => {
    const size = link.dataset.appleIconSize;
    if (size) link.href = `/${folder}/apple-touch-icon-${size}.png`;
  });

  const tileColor = document.getElementById("ms-tile-color") as HTMLMetaElement | null;
  if (tileColor) tileColor.content = mode === "dark" ? "#0b1411" : "#206f4a";

  const tileImage = document.getElementById("ms-tile-image") as HTMLMetaElement | null;
  if (tileImage) tileImage.content = `/${folder}/mstile-144x144.png`;
}

export function setupAdaptiveAppIcons() {
  applyAppIcons(modeFromDocument());

  const observer = new MutationObserver(() => applyAppIcons(modeFromDocument()));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    applyAppIcons(modeFromDocument());
  });
}
