import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateSettlement, useGetGroup, useGetSuggestedSettlements,
  getListSettlementsQueryKey, getGetGroupBalancesQueryKey, getGetGroupStatsQueryKey, getGetSuggestedSettlementsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

const schema = z.object({
  fromUserId: z.coerce.number().int().positive("Select payer"),
  toUserId: z.coerce.number().int().positive("Select receiver"),
  amount: z.coerce.number().positive("Amount must be positive"),
  date: z.string().min(1, "Date required"),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function Settle() {
  const params = useParams<{ id: string }>();
  const groupId = parseInt(params.id ?? "0", 10);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: group } = useGetGroup(groupId);
  const { data: suggested } = useGetSuggestedSettlements(groupId);

  const activeMembers = group?.members?.filter(m => m.isActive) ?? [];

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fromUserId: 0,
      toUserId: 0,
      amount: 0,
      date: new Date().toISOString().slice(0, 10),
      notes: "",
    },
  });

  const create = useCreateSettlement({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSettlementsQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getGetGroupBalancesQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getGetGroupStatsQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getGetSuggestedSettlementsQueryKey(groupId) });
        toast({ title: "Settlement recorded!" });
        setLocation(`/groups/${groupId}`);
      },
      onError: () => toast({ title: "Failed to record settlement", variant: "destructive" }),
    },
  });

  function onSubmit(values: FormValues) {
    create.mutate({ groupId, data: values });
  }

  function applySuggestion(s: { fromUserId: number; toUserId: number; amount: number }) {
    form.setValue("fromUserId", s.fromUserId);
    form.setValue("toUserId", s.toUserId);
    form.setValue("amount", s.amount);
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {suggested && suggested.length > 0 && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-emerald-900">Suggested Settlements</CardTitle>
            <CardDescription className="text-emerald-700">Click to prefill the form</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggested.map((s, i) => (
              <button
                key={i}
                onClick={() => applySuggestion(s)}
                className="w-full text-left p-2.5 rounded-md bg-white border border-emerald-200 hover:border-emerald-400 transition-colors text-sm"
              >
                <span className="font-medium">{s.fromUserName}</span>
                <span className="text-muted-foreground mx-2">pays</span>
                <span className="font-medium">{s.toUserName}</span>
                <span className="ml-auto float-right font-semibold text-emerald-700">{fmt(s.amount)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Record Settlement</CardTitle>
          <CardDescription>Log a payment between group members</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="fromUserId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Paid by</FormLabel>
                    <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value > 0 ? String(field.value) : ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Who paid?" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {activeMembers.map(m => <SelectItem key={m.userId} value={String(m.userId)}>{m.userName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="toUserId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Paid to</FormLabel>
                    <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value > 0 ? String(field.value) : ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Who received?" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {activeMembers.map(m => <SelectItem key={m.userId} value={String(m.userId)}>{m.userName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (INR)</FormLabel>
                    <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl><Textarea rows={2} {...field} /></FormControl>
                </FormItem>
              )} />

              <div className="flex gap-3 pt-1">
                <Button type="submit" disabled={create.isPending} className="flex-1">
                  {create.isPending ? "Recording…" : "Record Settlement"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setLocation(`/groups/${groupId}`)}>Cancel</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
