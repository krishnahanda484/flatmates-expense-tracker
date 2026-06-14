import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useListExchangeRates, useSetExchangeRate, getListExchangeRatesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  fromCurrency: z.string().min(1),
  toCurrency: z.string().min(1),
  rate: z.coerce.number().positive("Rate must be positive"),
  effectiveDate: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export default function ExchangeRates() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rates, isLoading } = useListExchangeRates();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fromCurrency: "USD",
      toCurrency: "INR",
      rate: 84,
      effectiveDate: new Date().toISOString().slice(0, 10),
    },
  });

  const setRate = useSetExchangeRate({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListExchangeRatesQueryKey() });
        toast({ title: "Exchange rate saved" });
      },
      onError: () => toast({ title: "Failed to save rate", variant: "destructive" }),
    },
  });

  function onSubmit(values: FormValues) {
    setRate.mutate({ data: values });
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Exchange Rates</h1>
        <p className="text-sm text-muted-foreground mt-1">Rates used for converting USD expenses to INR for balance calculations.</p>
      </div>

      {/* Existing rates */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Saved Rates</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : !rates || rates.length === 0 ? (
            <p className="text-muted-foreground text-sm">No rates saved. The default rate is 1 USD = 84 INR.</p>
          ) : (
            <div className="space-y-1">
              {rates.map(r => (
                <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                  <span className="font-medium">{r.fromCurrency} → {r.toCurrency}</span>
                  <span>{r.rate} <span className="text-muted-foreground">as of {r.effectiveDate}</span></span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/update rate */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Set Rate</CardTitle>
          <CardDescription>Add or update the exchange rate for a specific date</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <FormField control={form.control} name="fromCurrency" render={({ field }) => (
                  <FormItem>
                    <FormLabel>From</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="toCurrency" render={({ field }) => (
                  <FormItem>
                    <FormLabel>To</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="rate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate</FormLabel>
                    <FormControl><Input type="number" step="0.0001" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="effectiveDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Effective date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" disabled={setRate.isPending}>
                {setRate.isPending ? "Saving…" : "Save Rate"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
