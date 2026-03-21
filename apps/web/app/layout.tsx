import type { Metadata } from "next";
import "./globals.css";
import NavHeader from "@/components/NavHeader";

export const metadata: Metadata = {
  title: "KingSquare — Tournament management for Indian chess",
  description: "Register for chess tournaments, manage competitions, and track your entries on KingSquare — tournament management for Indian chess. A product of Easy Chess Academy.",
  keywords: ["chess", "tournament", "registration", "easy chess academy", "FIDE"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/*
          NavHeader is a client component — it reads sessionStorage to detect auth state
          and renders the role-aware avatar + logout dropdown (GAP 1 + GAP 2).
          The rest of the layout remains a Server Component for SSR/SEO benefits.
        */}
        <NavHeader />
        <main>{children}</main>
        <footer className="footer">
          <div className="container">
            <p style={{ color: '#999999' }}>
              <span style={{ color: '#FFFFFF', fontWeight: 500 }}>KingSquare</span>
              {' '}© {new Date().getFullYear()} · <span style={{ color: '#666666' }}>A product of Easy Chess Academy</span>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
