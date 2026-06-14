import { Link, useLocation } from "wouter";
import { useAuth, UserButton } from "@clerk/react";
import { cn } from "@/lib/utils";
import { Home, Users, Settings, LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/exchange-rates", label: "Exchange Rates", icon: Settings },
  ];

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <>
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClick}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <Sheet>
        <header className="md:hidden sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background px-4">
          <span className="font-semibold">Flatmates</span>
          <div className="flex items-center gap-4">
            <UserButton />
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
          </div>
        </header>
        <SheetContent side="left" className="w-64 p-0">
          <div className="flex h-full flex-col">
            <div className="border-b px-6 py-4">
              <span className="font-semibold text-lg">Flatmates</span>
            </div>
            <nav className="flex-1 space-y-1 p-4">
              <NavLinks />
            </nav>
          </div>
        </SheetContent>
      </Sheet>

      <aside className="hidden md:flex w-64 flex-col border-r bg-card/50">
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <span className="font-semibold text-lg">Flatmates</span>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          <NavLinks />
        </nav>
        <div className="border-t p-4 flex justify-between items-center">
          <UserButton />
          <span className="text-sm font-medium text-muted-foreground">My Account</span>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-5xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
