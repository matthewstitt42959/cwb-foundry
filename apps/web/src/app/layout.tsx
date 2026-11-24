import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Cards With Borders Foundry",
  description: "A rules-as-data card game engine and web app.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
