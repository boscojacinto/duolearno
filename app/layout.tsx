import type { Metadata } from "next";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "DuoLearno",
  description: "AI-powered interactive learning from PDFs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
