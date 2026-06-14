import { useLocation } from "wouter";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateGroup, getListGroupsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PlusCircle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().min(1, "Group name is required"),
  memberNames: z.array(z.object({ name: z.string() })),
});

type FormValues = z.infer<typeof schema>;

export default function NewGroup() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", memberNames: [{ name: "" }] },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "memberNames" });

  const create = useCreateGroup({
    mutation: {
      onSuccess: (group) => {
        qc.invalidateQueries({ queryKey: getListGroupsQueryKey() });
        toast({ title: "Group created!" });
        setLocation(`/groups/${group.id}`);
      },
      onError: () => toast({ title: "Failed to create group", variant: "destructive" }),
    },
  });

  function onSubmit(values: FormValues) {
    const memberNames = values.memberNames.map(m => m.name).filter(Boolean);
    create.mutate({ data: { name: values.name, memberNames } });
  }

  return (
    <div className="max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>New Group</CardTitle>
          <CardDescription>Create a group to start splitting expenses</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Flat 4B" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <p className="text-sm font-medium leading-none">Members (besides you)</p>
                {fields.map((field, idx) => (
                  <div key={field.id} className="flex gap-2">
                    <FormField
                      control={form.control}
                      name={`memberNames.${idx}.name`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input placeholder={`Member ${idx + 1} name`} {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(idx)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="ghost" size="sm" onClick={() => append({ name: "" })}>
                  <PlusCircle className="h-4 w-4 mr-1" /> Add member
                </Button>
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={create.isPending} className="flex-1">
                  {create.isPending ? "Creating…" : "Create Group"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setLocation("/")}>Cancel</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
