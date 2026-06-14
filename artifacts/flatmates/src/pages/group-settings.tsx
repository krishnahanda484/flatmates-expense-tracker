import { useParams, useLocation } from "wouter";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetGroup, useUpdateGroup, useAddGroupMember, useUpdateGroupMember, useRemoveGroupMember, useListUsers,
  getGetGroupQueryKey, getListGroupMembersQueryKey, getListGroupsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { PlusCircle, UserMinus, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const renameSchema = z.object({ name: z.string().min(1) });
const addMemberSchema = z.object({ name: z.string().min(1), joinedAt: z.string().min(1) });

export default function GroupSettings() {
  const params = useParams<{ id: string }>();
  const groupId = parseInt(params.id ?? "0", 10);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editingMembership, setEditingMembership] = useState<number | null>(null);
  const [leftAtVal, setLeftAtVal] = useState("");

  const { data: group, isLoading } = useGetGroup(groupId);

  const renameForm = useForm({ resolver: zodResolver(renameSchema), defaultValues: { name: group?.name ?? "" } });
  const addForm = useForm({ resolver: zodResolver(addMemberSchema), defaultValues: { name: "", joinedAt: new Date().toISOString().slice(0, 10) } });

  const updateGroup = useUpdateGroup({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getListGroupsQueryKey() });
        toast({ title: "Group renamed" });
      },
    },
  });

  const addMember = useAddGroupMember({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getListGroupMembersQueryKey(groupId) });
        addForm.reset();
        toast({ title: "Member added" });
      },
      onError: () => toast({ title: "Failed to add member", variant: "destructive" }),
    },
  });

  const updateMember = useUpdateGroupMember({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) });
        setEditingMembership(null);
        toast({ title: "Membership updated" });
      },
    },
  });

  const removeMember = useRemoveGroupMember({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) });
        toast({ title: "Member removed" });
      },
    },
  });

  if (isLoading || !group) return <div className="text-muted-foreground p-8">Loading…</div>;

  const members = group.members ?? [];

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Group Settings</h1>
        <p className="text-sm text-muted-foreground">{group.name}</p>
      </div>

      {/* Rename */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rename Group</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...renameForm}>
            <form onSubmit={renameForm.handleSubmit(v => updateGroup.mutate({ groupId, data: { name: v.name } }))} className="flex gap-2">
              <FormField control={renameForm.control} name="name" render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl><Input {...field} defaultValue={group.name} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" disabled={updateGroup.isPending}>Save</Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>Manage who is in this group and when they joined/left</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.map(m => (
            <div key={m.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{m.userName}</span>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Joined {m.joinedAt}{m.leftAt ? ` · Left ${m.leftAt}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {m.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Left</Badge>}
                  <button
                    onClick={() => { setEditingMembership(editingMembership === m.id ? null : m.id); setLeftAtVal(m.leftAt ?? ""); }}
                    className="p-1 rounded text-muted-foreground hover:text-foreground"
                  >
                    <Calendar className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeMember.mutate({ groupId, membershipId: m.id })}
                    className="p-1 rounded text-muted-foreground hover:text-destructive"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {editingMembership === m.id && (
                <div className="flex items-center gap-2 bg-muted/40 rounded-md p-2">
                  <span className="text-xs text-muted-foreground">Left on:</span>
                  <Input type="date" className="h-7 text-xs" value={leftAtVal} onChange={e => setLeftAtVal(e.target.value)} />
                  <Button size="sm" className="h-7" onClick={() =>
                    updateMember.mutate({ groupId, membershipId: m.id, data: { leftAt: leftAtVal || null } })
                  }>Save</Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditingMembership(null)}>Cancel</Button>
                </div>
              )}
            </div>
          ))}

          <Separator className="my-3" />

          {/* Add member */}
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(v => addMember.mutate({ groupId, data: { userId: 0, joinedAt: v.joinedAt, userName: v.name } }))} className="space-y-2">
              <p className="text-sm font-medium">Add member</p>
              <div className="grid grid-cols-2 gap-2">
                <FormField control={addForm.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormControl><Input placeholder="Name" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={addForm.control} name="joinedAt" render={({ field }) => (
                  <FormItem>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <Button type="submit" size="sm" disabled={addMember.isPending}>
                <PlusCircle className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => setLocation(`/groups/${groupId}`)}>Back to Group</Button>
    </div>
  );
}
