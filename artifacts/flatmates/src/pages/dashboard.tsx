import { useGetMe, useListGroups, useGetGroupActivity } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, ArrowRight } from "lucide-react";

export default function Dashboard() {
  const { data: me, isLoading: meLoading } = useGetMe();
  const { data: groups, isLoading: groupsLoading } = useListGroups();

  if (meLoading || groupsLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, {me?.name}.</p>
        </div>
        <Link href="/groups/new">
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            New Group
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {groups?.map((group) => (
          <Card key={group.id} className="hover-elevate cursor-pointer transition-colors hover:border-primary/50">
            <Link href={`/groups/${group.id}`} className="block h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{group.name}</CardTitle>
                <CardDescription>Created {new Date(group.createdAt).toLocaleDateString()}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm mt-4">
                  <span className="text-muted-foreground">View details</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Link>
          </Card>
        ))}
        {groups?.length === 0 && (
          <Card className="col-span-full bg-muted/50 border-dashed">
            <CardContent className="flex flex-col items-center justify-center h-48 text-center">
              <p className="text-muted-foreground mb-4">You aren't in any groups yet.</p>
              <Link href="/groups/new">
                <Button variant="outline">Create your first group</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
