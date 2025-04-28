"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FileText, MessageSquareMore } from "lucide-react";
import { cn } from "@/lib/utils"; // Assuming you have a cn utility

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { href: "/", label: "Home", icon: <Home size={18} /> },
  { href: "/privacy", label: "Privacy", icon: <FileText size={18} /> },
  {
    href: "/support",
    label: "Support",
    icon: <MessageSquareMore size={18} />,
  },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-neutral-700/50 bg-neutral-900/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <Link
              href="/"
              className="flex-shrink-0 flex items-center gap-2 text-white font-bold text-lg"
            >
              {/* Optional: Add a logo here */}
              {/* <img className="h-8 w-auto" src="/logo.svg" alt="YouTube Dubbing" /> */}
              <span>YouTube Dubbing</span>
            </Link>
          </div>
          <div className="hidden sm:ml-6 sm:flex sm:space-x-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  pathname === item.href
                    ? "bg-violet-600 text-white"
                    : "text-neutral-300 hover:bg-neutral-700/50 hover:text-white"
                )}
                aria-current={pathname === item.href ? "page" : undefined}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
          {/* TODO: Add mobile menu button if needed */}
        </div>
      </div>
    </nav>
  );
}
