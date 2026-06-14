import { useParams, useLocation } from "wouter";
import { useState, useRef } from "react";
import { usePreviewImport, useConfirmImport, getListExpensesQueryKey, getGetGroupBalancesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, CheckCircle, AlertTriangle, XCircle, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ImportIssue = {
  rowNumber: number;
  issueType: string;
  description: string;
  actionTaken: string;
  severity: "error" | "warning" | "info";
};

type PreviewRow = {
  rowNumber: number;
  description: string;
  amount: number | null;
  currency: string;
  paidBy: string;
  splitType: string;
  date: string;
  status: "ok" | "skipped" | "needs_review";
  issues: ImportIssue[];
};

type Preview = {
  sessionToken: string;
  totalRows: number;
  validRows: number;
  skippedRows: number;
  issueCount: number;
  issues: ImportIssue[];
  rows: PreviewRow[];
};

const severityIcon = {
  error: <XCircle className="h-3.5 w-3.5 text-destructive" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />,
  info: <CheckCircle className="h-3.5 w-3.5 text-blue-500" />,
};

const statusBadge = {
  ok: <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">OK</Badge>,
  needs_review: <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Review</Badge>,
  skipped: <Badge variant="destructive">Skipped</Badge>,
};

export default function Import() {
  const params = useParams<{ id: string }>();
  const groupId = parseInt(params.id ?? "0", 10);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [filename, setFilename] = useState("");

  const previewMutation = usePreviewImport({
    mutation: {
      onSuccess: (data) => setPreview(data as Preview),
      onError: () => toast({ title: "Failed to parse CSV", variant: "destructive" }),
    },
  });

  const confirmMutation = useConfirmImport({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getListExpensesQueryKey(groupId) });
        qc.invalidateQueries({ queryKey: getGetGroupBalancesQueryKey(groupId) });
        toast({ title: `Imported ${(data as any).importedCount} expenses, skipped ${(data as any).skippedCount}` });
        setLocation(`/groups/${groupId}`);
      },
      onError: () => toast({ title: "Import failed", variant: "destructive" }),
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const csvContent = ev.target?.result as string;
      previewMutation.mutate({ data: { csvContent, groupId } });
    };
    reader.readAsText(file);
  }

  function handleConfirm() {
    if (!preview) return;
    confirmMutation.mutate({ data: { sessionToken: preview.sessionToken, groupId } });
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Import CSV</h1>
        <p className="text-muted-foreground text-sm mt-1">Upload your expenses_export.csv — the importer will detect and report every anomaly.</p>
      </div>

      {/* File upload area */}
      {!preview && (
        <Card>
          <CardContent className="pt-6">
            <div
              className="border-2 border-dashed border-muted rounded-xl p-12 flex flex-col items-center gap-4 cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-10 w-10 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">Click to select a CSV file</p>
                <p className="text-sm text-muted-foreground">expenses_export.csv</p>
              </div>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
            </div>
            {previewMutation.isPending && (
              <p className="text-center text-muted-foreground mt-4 text-sm">Parsing CSV…</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Preview results */}
      {preview && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Total rows", value: preview.totalRows },
              { label: "Valid", value: preview.validRows, cls: "text-emerald-700" },
              { label: "Skipped", value: preview.skippedRows, cls: "text-rose-700" },
              { label: "Issues", value: preview.issueCount, cls: "text-yellow-700" },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.cls ?? ""}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Anomaly report */}
          {preview.issues.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Anomaly Report
                </CardTitle>
                <CardDescription>Every data problem detected and how it was handled</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {preview.issues.map((issue, i) => (
                    <div key={i} className="flex gap-3 items-start p-2.5 rounded-md bg-muted/40 text-sm">
                      <div className="mt-0.5 shrink-0">{severityIcon[issue.severity]}</div>
                      <div className="min-w-0">
                        <p><span className="font-medium">Row {issue.rowNumber}</span> · <span className="text-muted-foreground">{issue.issueType.replace(/_/g, " ")}</span></p>
                        <p className="text-muted-foreground text-xs mt-0.5">{issue.description}</p>
                        <p className="text-xs mt-0.5 italic">Action: {issue.actionTaken}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Row preview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Row Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left pb-2 font-medium text-muted-foreground">#</th>
                      <th className="text-left pb-2 font-medium text-muted-foreground">Date</th>
                      <th className="text-left pb-2 font-medium text-muted-foreground">Description</th>
                      <th className="text-left pb-2 font-medium text-muted-foreground">Amount</th>
                      <th className="text-left pb-2 font-medium text-muted-foreground">Paid by</th>
                      <th className="text-left pb-2 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.rows.map(row => (
                      <tr key={row.rowNumber} className="hover:bg-muted/30">
                        <td className="py-1.5 pr-3 text-muted-foreground">{row.rowNumber}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{row.date}</td>
                        <td className="py-1.5 pr-3 font-medium">{row.description}</td>
                        <td className="py-1.5 pr-3">{row.amount != null ? `${row.currency} ${row.amount}` : "-"}</td>
                        <td className="py-1.5 pr-3">{row.paidBy}</td>
                        <td className="py-1.5">{statusBadge[row.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Alert>
            <AlertDescription>
              <strong>{preview.validRows}</strong> expenses will be imported.{" "}
              <strong>{preview.skippedRows}</strong> rows will be skipped.{" "}
              Review the anomaly report above before confirming.
            </AlertDescription>
          </Alert>

          <div className="flex gap-3">
            <Button onClick={handleConfirm} disabled={confirmMutation.isPending} className="flex-1">
              {confirmMutation.isPending ? "Importing…" : `Confirm Import (${preview.validRows} rows)`}
            </Button>
            <Button variant="outline" onClick={() => { setPreview(null); setFilename(""); }}>
              Upload different file
            </Button>
            <Button variant="ghost" onClick={() => setLocation(`/groups/${groupId}`)}>Cancel</Button>
          </div>
        </>
      )}
    </div>
  );
}
