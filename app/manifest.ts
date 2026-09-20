import type { MetadataRoute } from "next";

/**
 * What Windows, Edge and Chrome need to install the console as a desktop app:
 * its own icon and Start-menu entry, opening in a plain window with no address
 * bar, rather than a browser tab someone has to find a URL for.
 *
 * Deliberately not an .exe. Installing this needs no administrator rights on
 * the office PCs and updates itself when the site is updated, where a packaged
 * installer would have to be re-signed and re-deployed to every machine.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MEEDO Admin Console — South Wao Water System",
    short_name: "MEEDO Admin",
    description:
      "Billing, collections, connections and field operations for the South Wao Water System.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // The window chrome takes the header's colour; the page sits on the same
    // light ground the app uses, so launching doesn't flash white then dark.
    theme_color: "#020617",
    background_color: "#f8fafc",
    categories: ["business", "utilities", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Cropped to a circle or squircle by the OS, so it carries its own ground
      // and keeps the logo inside the safe area.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
