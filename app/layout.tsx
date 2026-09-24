import type { Metadata } from "next";
import { DM_Sans, Lexend } from "next/font/google";
import "./globals.css";

const lexend = Lexend({
  variable: "--font-lexend",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Qualita · Intranet",
  description: "Intranet del equipo de Qualita Studio",
  icons: { icon: "/favicon.png" },
};

// Aplica el tema guardado antes del primer paint (evita el flash claro→oscuro).
const themeScript = `try{if(localStorage.getItem("theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`${lexend.variable} ${dmSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      {/* Extensiones del navegador (p. ej. ColorZilla) agregan atributos al body antes de hidratar. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
