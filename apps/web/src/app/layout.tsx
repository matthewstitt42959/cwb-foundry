import type { ReactNode } from "react";

export const metadata = {
  title: "Cards With Borders Foundry",
  description: "A rules-as-data card game engine and web app.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#0e0e12",
          color: "#e8e6df",
        }}
      >
        {children}
      </body>
    </html>
  );
}
