import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Easy Chess Academy — Tournament Platform",
  description: "Register for chess tournaments, manage competitions, and track your entries with Easy Chess Academy's premier tournament platform.",
  keywords: ["chess", "tournament", "registration", "easy chess academy", "FIDE"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="header">
          <div className="container header-inner">
            <a href="/" className="logo">
              <span className="logo-icon">♔</span>
              Easy Chess Academy
            </a>
            <nav>
              <ul className="nav-links">
                <li><a href="/" className="nav-link active">Tournaments</a></li>
                <li><a href="/organizer/login" className="nav-link">Organizer</a></li>
              </ul>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <div className="container">
            <p>© {new Date().getFullYear()} Easy Chess Academy. All rights reserved.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
