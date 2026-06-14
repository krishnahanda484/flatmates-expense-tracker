import { useParams, useLocation } from "wouter";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateExpense, useGetGroup, useListUsers,
  getListExpensesQueryKey, getGetGroupBalancesQueryKey, getGetGroupStatsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

const splitTypes = ["equal", "percentage", "exact", "share"] as const;

const schema = z.object({
  description: z.string().min(1, "Description required"),
  amount: z.coerce.number().positive("Must be positive"),
  currency: z.string().default("INR"),
  splitType: z.enum(splitTypes),
  date: z.string().min(1, "Date required"),
  paidByUserId: z.coerce.number().int().positive("Select who paid"),
  notes: z.string().optional(),
  selectedMemberIds: z.array(z.number()).min(1, "Select at least one member"),
  splits: z.array(z.object({
    userId: z.number(),
    name: z.string(),
    value: z.coerce.number().default(0),
  })),
});

type FormValues = z.infer<typeof schema>;

export default function NewExpense() {
  const params = useParams<{ id: string }>();
  const groupId = parseInt(params.id ?? "0", 10);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: group } = useGetGroup(groupId);
  const { data: allUsers } = useListUsers();

  const activeMembers = group?.members?.filter(m => m.isActive) ?? [];

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      description: "",
      amount: 0,
      currency: "INR",
      splitType: "equal",
      date: new Date().toISOString().slice(0, 10),
      paidByUserId: 0,
      notes: "",
      selectedMemberIds: [],
      splits: [],
    },
  });

  const watchSplitType = form.watch("splitType");
  const watchSelected = form.watch("selectedMemberIds");
  const watchAmount = form.watch("amount");

  // Init splits when members or split type changes
  useEffect(() => {
    const selectedMembers = activeMembers.filter(m => watchSelected.includes(m.userId));
    const existing = form.getValues("splits");
    const newSplits = selectedMembers.map(m => {
      const ex = existing.find(s => s.userId === m.userId);
      let val = ex?.value ?? 0;
      if (watchSplitType === "equal" && watchAmount > 0) {
        val = Math.round((watchAmount / selectedMembers.length) * 100) / 100;
      } else if (watchSplitType === "percentage" && selectedMembers.length > 0) {
        val = ex?.value ?? Math.round((100 / selectedMembers.length) * 100) / 100;
      } else if (watchSplitType === "share") {
        val = ex?.value ?? 1;
      }
      return { userId: m.userId, name: m.userName, value: val };
    });
    form.setValue("splits", newSplits);
  }, [JSON.stringify(watchSelected), watchSplitType, watchAmount]);

  const create = useCreateExpense({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListExpensesQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getGetGroupBalancesQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getGetGroupStatsQueryKey(groupId) });
        toast({ title: "Expense added!" });
        setLocation(`/groups/${groupId}`);
      },
      onError: () => toast({ title: "Failed to add expense", variant: "destructive" }),
    },
  });

  function buildSplits(values: FormValues) {
    const { splitType, amount, selectedMemberIds, splits } = values;
    const currency = values.currency;
    const amtInr = currency === "INR" ? amount : amount; // server handles conversion

    const memberSplits = splits.filter(s => selectedMemberIds.includes(s.userId));

    if (splitType === "equal") {
      const each = Math.round((amtInr / memberSplits.length) * 100) / 100;
      return memberSplits.map(s => ({ userId: s.userId, amountOwed: each }));
    }
    if (splitType === "percentage") {
      const total = memberSplits.reduce((s, m) => s + m.value, 0);
      return memberSplits.map(s => ({
        userId: s.userId,
        amountOwed: Math.round((amtInr * s.value / (total || 100)) * 100) / 100,
        percentage: s.value,
      }));
    }
    if (splitType === "exact") {
      return memberSplits.map(s => ({ userId: s.userId, amountOwed: s.value }));
    }
    if (splitType === "share") {
      const totalShares = memberSplits.reduce((s, m) => s + m.value, 0);
      return memberSplits.map(s => ({
        userId: s.userId,
        amountOwed: Math.round((amtInr * s.value / (totalShares || 1)) * 100) / 100,
        shareCount: s.value,
      }));
    }
    return memberSplits.map(s => ({ userId: s.userId, amountOwed: 0 }));
  }

  function onSubmit(values: FormValues) {
    const splits = buildSplits(values);
    create.mutate({
      groupId,
      data: {
        description: values.description,
        amount: values.amount,
        currency: values.currency,
        splitType: values.splitType,
        date: values.date,
        paidByUserId: values.paidByUserId,
        notes: values.notes,
        splits,
      },
    });
  }

  return (
    <div className="max-w-xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Add Expense</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Input placeholder="e.g. March rent" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="currency" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="INR">INR</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="paidByUserId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Paid by</FormLabel>
                    <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value > 0 ? String(field.value) : ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {activeMembers.map(m => (
                          <SelectItem key={m.userId} value={String(m.userId)}>{m.userName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="splitType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Split type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {splitTypes.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Member selection */}
              <FormField control={form.control} name="selectedMemberIds" render={() => (
                <FormItem>
                  <FormLabel>Split with</FormLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {activeMembers.map(m => {
                      const checked = watchSelected.includes(m.userId);
                      return (
                        <label key={m.userId} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              const current = form.getValues("selectedMemberIds");
                              form.setValue("selectedMemberIds",
                                v ? [...current, m.userId] : current.filter(id => id !== m.userId)
                              );
                            }}
                          />
                          <span className="text-sm">{m.userName}</span>
                        </label>
                      );
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Split detail inputs */}
              {watchSplitType !== "equal" && watchSelected.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium leading-none">
                    {watchSplitType === "percentage" ? "Percentages (must total 100%)" :
                     watchSplitType === "exact" ? "Exact amounts (INR)" :
                     "Shares (relative portions)"}
                  </p>
                  {form.getValues("splits").filter(s => watchSelected.includes(s.userId)).map((split, idx) => (
                    <div key={split.userId} className="flex items-center gap-3">
                      <span className="text-sm w-24 truncate">{split.name}</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={split.value}
                        onChange={(e) => {
                          const splits = form.getValues("splits");
                          const realIdx = splits.findIndex(s => s.userId === split.userId);
                          if (realIdx >= 0) {
                            splits[realIdx]!.value = parseFloat(e.target.value) || 0;
                            form.setValue("splits", [...splits]);
                          }
                        }}
                        className="flex-1"
                      />
                      {watchSplitType === "percentage" && <span className="text-muted-foreground text-sm">%</span>}
                    </div>
                  ))}
                </div>
              )}

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl><Textarea rows={2} placeholder="Any notes…" {...field} /></FormControl>
                </FormItem>
              )} />

              <div className="flex gap-3 pt-1">
                <Button type="submit" disabled={create.isPending} className="flex-1">
                  {create.isPending ? "Adding…" : "Add Expense"}
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
