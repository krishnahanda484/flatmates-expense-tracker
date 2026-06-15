import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Switch, Route, Redirect, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import GroupDetail from "@/pages/group-detail";
import NewGroup from "@/pages/new-group";
import NewExpense from "@/pages/new-expense";
import ExpenseDetail from "@/pages/expense-detail";
import Settle from "@/pages/settle";
import Import from "@/pages/import";
import GroupSettings from "@/pages/group-settings";
import ExchangeRates from "@/pages/exchange-rates";

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ProtectedRoute({ component: Component, ...rest }: any) {
  return (
    <Route {...rest}>
      <AppLayout>
        <Component />
      </AppLayout>
    </Route>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <AppLayout>
          <Dashboard />
        </AppLayout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}


function ClerkAuthSetup() {
  const clerk = useClerk();

  useEffect(() => {
    setAuthTokenGetter(async () => {
      return await clerk.session?.getToken();
    });

    return () => {
      setAuthTokenGetter(null);
    };
  }, [clerk]);

  return null;
}


function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  if (!clerkPubKey) {
    return <div>Missing VITE_CLERK_PUBLISHABLE_KEY</div>;
  }

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />

          <Route path="/groups/new" component={() => <AppLayout><NewGroup /></AppLayout>} />
          <Route path="/groups/:id/expenses/new" component={() => <AppLayout><NewExpense /></AppLayout>} />
          <Route path="/groups/:id/expenses/:expenseId" component={() => <AppLayout><ExpenseDetail /></AppLayout>} />
          <Route path="/groups/:id/settle" component={() => <AppLayout><Settle /></AppLayout>} />
          <Route path="/groups/:id/import" component={() => <AppLayout><Import /></AppLayout>} />
          <Route path="/groups/:id/settings" component={() => <AppLayout><GroupSettings /></AppLayout>} />
          <Route path="/groups/:id" component={() => <AppLayout><GroupDetail /></AppLayout>} />
          <Route path="/exchange-rates" component={() => <AppLayout><ExchangeRates /></AppLayout>} />

          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;