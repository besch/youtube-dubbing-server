import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { Nav } from "@/components/layout/nav";
import { ThemeProvider } from "@/components/theme-provider";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "YouTube Dubbing",
  description: "Watch YouTube videos with AI-generated dubbing",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <NuqsAdapter>
            <div className="relative flex min-h-screen flex-col">
              <Nav />
              <main className="flex-1">{children}</main>
            </div>
            <Toaster />
          </NuqsAdapter>
        </ThemeProvider>
      </body>
    </html>
  );
}
