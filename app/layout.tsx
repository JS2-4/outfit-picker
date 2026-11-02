import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Outfit,
  Plus_Jakarta_Sans,
  Varela_Round,
} from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { FontProvider } from "@/contexts/FontContext";
import { PendingUploadsProvider } from "./PendingUploadsContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Selectable body faces, exposed as CSS variables that globals.css switches
// between via [data-font]. next/font downloads and SELF-HOSTS these at build
// time — the browser never contacts Google, so there's no third-party request
// at runtime and no CDN to be offline. It does mean the build machine needs
// network access the first time it fetches them.
//
// Both are geometric sans faces in the same territory as the Instagram brand
// font, which is proprietary to Meta and not licensable for use here. These
// two are OFL, so they can ship with the app.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

// weight is REQUIRED here where the other faces omit it. Outfit and Plus
// Jakarta Sans are variable fonts, so next/font pulls the whole weight axis
// on its own. Varela Round ships a single static 400 and no variable version,
// and next/font throws at build time on a non-variable family unless the
// weight is named explicitly.
//
// Consequence to know about: 400 is the ONLY weight that exists. Anywhere the
// UI asks for font-medium — the active category tab, the SETTINGS heading —
// the browser synthesises a faux bold by smearing the 400 outlines rather
// than loading a real 500. It's legible, just slightly softer than the true
// weights the other faces resolve to.
const varela = Varela_Round({
  variable: "--font-varela",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Outfit Picker",
  description: "Your digital closet",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} ${jakarta.variable} ${varela.variable} h-full antialiased`}
    >
      <head>
        {/* Runs before first paint, which is the entire point — both of these
            settings live in localStorage, and localStorage can't be read on
            the server. Without this the first paint would use the defaults and
            then visibly snap to the stored theme and face once React hydrated.
            Applying them to <html> here means the very first frame is already
            correct, and the providers' effects only catch React's state up to
            what the DOM is already showing. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var darkMode = localStorage.getItem("darkMode");
                if (darkMode === "true") {
                  document.documentElement.classList.add("dark");
                }
                var font = localStorage.getItem("font");
                if (font) {
                  document.documentElement.setAttribute("data-font", font);
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ConvexClientProvider>
          <ThemeProvider>
            <FontProvider>
              {/* Provided here (above every route) rather than inside
                  app/page.tsx, specifically so an in-progress upload's
                  pending/skeleton-tile state survives navigating away from
                  the grid page and back — see PendingUploadsContext.tsx. */}
              <PendingUploadsProvider>{children}</PendingUploadsProvider>
            </FontProvider>
          </ThemeProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}