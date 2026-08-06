import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sternenpfad · Programmieren für kleine Entdecker",
  description: "Eine erzählte Programmier-Abenteuerreise für Kinder ab 7.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
