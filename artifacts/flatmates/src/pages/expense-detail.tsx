import { useParams, Link } from "wouter";
import { useGetExpense } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

export default function ExpenseDetail() {
  const params = useParams<{ id: string; expenseId: string }>();
  const groupId = params.id;
  const expenseId = parseInt(params.expenseId ?? "0", 10);

  const { data: expense, isLoading } = useGetExpense(expenseId);

  if (isLoading) return (
    <div className="max-w-xl mx-auto space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-48" />
    </div>
  );

  if (!expense) return <div className="text-muted-foreground p-8">Expense not found.</div>;

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <Link href={`/groups/${groupId}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to group
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{expense.description}</CardTitle>
              <CardDescription className="mt-1">
                Paid by <span className="font-medium text-foreground">{expense.paidByName}</span> · {expense.date}
              </CardDescription>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">
                {expense.currency !== "INR" ? `${expense.currency} ${expense.amount}` : fmt(expense.amountInr)}
              </p>
              {expense.currency !== "INR" && (
                <p className="text-sm text-muted-foreground">{fmt(expense.amountInr)} INR</p>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">{expense.splitType} split</Badge>
            {expense.isSettlement && <Badge variant="secondary">Settlement</Badge>}
          </div>

          {expense.notes && (
            <p className="text-sm text-muted-foreground italic">{expense.notes}</p>
          )}

          {expense.splits && expense.splits.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-2">Split breakdown</p>
              <div className="space-y-1">
                {expense.splits.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-md bg-muted/50">
                    <span className="font-medium">{s.userName}</span>
                    <div className="text-right">
                      <span className="font-semibold">{fmt(s.amountOwed)}</span>
                      {s.percentage != null && (
                        <span className="text-muted-foreground ml-2">({s.percentage}%)</span>
                      )}
                      {s.shareCount != null && (
                        <span className="text-muted-foreground ml-2">({s.shareCount} share{s.shareCount !== 1 ? "s" : ""})</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
