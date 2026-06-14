import { useParams, Link } from "wouter";
import {
  useGetGroup, useGetGroupBalances, useGetSuggestedSettlements,
  useGetGroupStats, useGetGroupActivity, useListExpenses, useListSettlements,
  useDeleteExpense, useDeleteSettlement,
  getGetGroupBalancesQueryKey, getGetGroupStatsQueryKey, getGetGroupActivityQueryKey,
  getListExpensesQueryKey, getListSettlementsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusCircle, ArrowRight, Upload, Settings, Trash2, TrendingUp, TrendingDown, Minus
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

function BalanceBadge({ amount }: { amount: number }) {
  if (Math.abs(amount) < 0.01) return <Badge variant="secondary" className="gap-1"><Minus className="h-3 w-3" /> Settled</Badge>;
  if (amount > 0) return <Badge className="gap-1 bg-emerald-100 text-emerald-800 border-emerald-200"><TrendingUp className="h-3 w-3" /> +{fmt(amount)}</Badge>;
  return <Badge variant="destructive" className="gap-1"><TrendingDown className="h-3 w-3" /> {fmt(amount)}</Badge>;
}

export default function GroupDetail() {
  const params = useParams<{ id: string }>();
  const groupId = parseInt(params.id ?? "0", 10);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: group, isLoading: groupLoading } = useGetGroup(groupId);
  const { data: balances } = useGetGroupBalances(groupId);
  const { data: suggested } = useGetSuggestedSettlements(groupId);
  const { data: stats } = useGetGroupStats(groupId);
  const { data: activity } = useGetGroupActivity(groupId);
  const { data: expenses, isLoading: expLoading } = useListExpenses(groupId);
  const { data: settlements } = useListSettlements(groupId);

  const deleteExpense = useDeleteExpense({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListExpensesQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getGetGroupBalancesQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getGetGroupStatsQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getGetGroupActivityQueryKey(groupId) });
        toast({ title: "Expense deleted" });
      },
    },
  });

  const deleteSettlement = useDeleteSettlement({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSettlementsQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getGetGroupBalancesQueryKey(groupId) });
        toast({ title: "Settlement deleted" });
      },
    },
  });

  if (groupLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  if (!group) return <div className="p-8 text-muted-foreground">Group not found.</div>;

  const activeMembers = group.members?.filter(m => m.isActive) ?? [];
  const regularExpenses = expenses?.filter(e => !e.isSettlement) ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{group.name}</h1>
          <p className="text-sm text-muted-foreground">{activeMembers.length} active members</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href={`/groups/${groupId}/import`}>
            <Button variant="outline" size="sm"><Upload className="h-4 w-4 mr-1" /> Import CSV</Button>
          </Link>
          <Link href={`/groups/${groupId}/settle`}>
            <Button variant="outline" size="sm">Record Settlement</Button>
          </Link>
          <Link href={`/groups/${groupId}/expenses/new`}>
            <Button size="sm"><PlusCircle className="h-4 w-4 mr-1" /> Add Expense</Button>
          </Link>
          <Link href={`/groups/${groupId}/settings`}>
            <Button variant="ghost" size="icon"><Settings className="h-4 w-4" /></Button>
          </Link>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Group Spend</p>
              <p className="text-2xl font-bold mt-1">{fmt(stats.totalSpend)}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.expenseCount} expenses</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Settled</p>
              <p className="text-2xl font-bold mt-1 text-emerald-700">{fmt(stats.totalSettled)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Outstanding Debt</p>
              <p className="text-2xl font-bold mt-1 text-rose-700">{fmt(stats.outstandingDebt)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="balances">
        <TabsList>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="expenses">Expenses ({regularExpenses.length})</TabsTrigger>
          <TabsTrigger value="settlements">Settlements</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Balances tab */}
        <TabsContent value="balances" className="space-y-4 mt-4">
          {balances && (
            <div className="grid gap-3 md:grid-cols-2">
              {balances.members.map(m => (
                <Card key={m.userId}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">{m.userName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Paid {fmt(m.totalPaid)} · Owes {fmt(m.totalOwed)}</p>
                      </div>
                      <BalanceBadge amount={m.netBalance} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {suggested && suggested.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Suggested Settlements</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {suggested.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                    <span>
                      <span className="font-medium">{s.fromUserName}</span>
                      <span className="text-muted-foreground mx-2">pays</span>
                      <span className="font-medium">{s.toUserName}</span>
                    </span>
                    <span className="font-semibold text-rose-700">{fmt(s.amount)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Expenses tab */}
        <TabsContent value="expenses" className="mt-4">
          {expLoading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>
          ) : regularExpenses.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No expenses yet.</p>
              <Link href={`/groups/${groupId}/expenses/new`}>
                <Button variant="outline" className="mt-3">Add first expense</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {regularExpenses.map(e => (
                <div key={e.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors group">
                  <Link href={`/groups/${groupId}/expenses/${e.id}`} className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{e.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.paidByName} · {e.date} · <span className="uppercase">{e.splitType}</span>
                        </p>
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-2 ml-3">
                    <div className="text-right">
                      <p className="font-semibold">{e.currency !== "INR" ? `${e.currency} ${e.amount}` : fmt(e.amountInr)}</p>
                      {e.currency !== "INR" && <p className="text-xs text-muted-foreground">{fmt(e.amountInr)}</p>}
                    </div>
                    <button
                      onClick={() => deleteExpense.mutate({ expenseId: e.id })}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Settlements tab */}
        <TabsContent value="settlements" className="mt-4">
          {!settlements || settlements.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No settlements recorded.</p>
              <Link href={`/groups/${groupId}/settle`}>
                <Button variant="outline" className="mt-3">Record first settlement</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {settlements.map(s => (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border bg-card group">
                  <div>
                    <p className="font-medium">{s.fromUserName} <span className="text-muted-foreground font-normal">→</span> {s.toUserName}</p>
                    <p className="text-xs text-muted-foreground">{s.date}{s.notes ? ` · ${s.notes}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-emerald-700">{fmt(s.amount)}</span>
                    <button
                      onClick={() => deleteSettlement.mutate({ settlementId: s.id })}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Activity tab */}
        <TabsContent value="activity" className="mt-4">
          {!activity || activity.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="space-y-1">
              {activity.map(item => (
                <div key={item.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-accent/20">
                  <div>
                    <p className="text-sm font-medium">{item.description}</p>
                    <p className="text-xs text-muted-foreground">{item.userName} · {item.date}</p>
                  </div>
                  {item.amount != null && (
                    <span className="text-sm font-semibold text-muted-foreground">
                      {item.type === "settlement" ? "+" : ""}{fmt(item.amount)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
