import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Clock, Play, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useManualScanAccess } from "@/hooks/use-manual-scan-access";
import { manualTrpcClient, useTRPC } from "@/lib/trpc";

const when = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString() : "never");

export function DailyScanCard() {
  const trpc = useTRPC();
  const scanAccess = useManualScanAccess();
  const queryClient = useQueryClient();
  const settings = useQuery({ ...trpc.settings.get.queryOptions(), refetchInterval: (q) => (q.state.data?.job.running ? 3000 : false) });
  const refresh = () => queryClient.invalidateQueries(trpc.settings.get.queryFilter());

  const [enabled, setEnabled] = useState(true);
  const [time, setTime] = useState("07:00");
  const [topic, setTopic] = useState("");
  const [remindersOn, setRemindersOn] = useState(true);
  const [reminderDays, setReminderDays] = useState(7);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (settings.data && !loaded) {
      setEnabled(settings.data.dailyScanEnabled);
      setTime(settings.data.dailyScanTime);
      setTopic(settings.data.ntfyTopic);
      setRemindersOn(settings.data.closingRemindersEnabled);
      setReminderDays(settings.data.closingReminderDays);
      setLoaded(true);
    }
  }, [settings.data, loaded]);

  const save = useMutation({
    mutationFn: (input: Parameters<typeof manualTrpcClient.settings.save.mutate>[0]) => manualTrpcClient.settings.save.mutate(input),
    onSuccess: refresh,
  });
  const test = useMutation(trpc.settings.testNotification.mutationOptions());
  const runNow = useMutation({ mutationFn: () => manualTrpcClient.settings.runNow.mutate(), onSuccess: refresh });
  const recheck = useMutation({ mutationFn: () => manualTrpcClient.settings.recheckLegacy.mutate(), onSuccess: refresh });
  const remindNow = useMutation(trpc.settings.sendRemindersNow.mutationOptions({ onSuccess: refresh }));

  const data = settings.data;
  const dirty =
    !!data &&
    (enabled !== data.dailyScanEnabled ||
      time !== data.dailyScanTime ||
      topic !== data.ntfyTopic ||
      remindersOn !== data.closingRemindersEnabled ||
      reminderDays !== data.closingReminderDays);
  const job = data?.job;

  return (
    <Card>
      {scanAccess.dialog}
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4" /> Daily rescan &amp; notifications
        </CardTitle>
        <CardDescription>
          Rescans the shared catalogue each day and sends a summary to the service's ntfy topic: what newly opened, what closed, and what's open now. The backend
          has to be running at that time. If it was off, it catches up when it starts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Switch id="daily-enabled" checked={enabled} onCheckedChange={setEnabled} />
          <Label htmlFor="daily-enabled">Rescan every day</Label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="daily-time">Time (your local time)</Label>
            <Input id="daily-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!enabled} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ntfy-topic">ntfy topic</Label>
            <Input id="ntfy-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="your_topic_name" />
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <Switch id="reminders-enabled" checked={remindersOn} onCheckedChange={setRemindersOn} />
            <Label htmlFor="reminders-enabled">Send alerts when listings are about to close</Label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Starting
            <Input
              type="number"
              min={1}
              max={30}
              value={reminderDays}
              onChange={(e) => setReminderDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              disabled={!remindersOn}
              className="w-16"
              aria-label="Days before closing"
            />
            days before the closing date, send a separate alert for each listing, every day until it closes. Alerts get more urgent in the final days.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!dirty || save.isPending || scanAccess.busy}
            onClick={() =>
              void scanAccess.run(() => save.mutateAsync({
                dailyScanEnabled: enabled,
                dailyScanTime: time,
                ntfyTopic: topic,
                closingRemindersEnabled: remindersOn,
                closingReminderDays: reminderDays,
              }))
            }
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button variant="outline" size="sm" disabled={test.isPending || dirty} onClick={() => test.mutate()} title={dirty ? "Save first" : "Send a test notification"}>
            <Send /> {test.isPending ? "Sending…" : "Send test notification"}
          </Button>
          <Button variant="outline" size="sm" disabled={runNow.isPending || job?.running || dirty || scanAccess.busy} onClick={() => void scanAccess.run(() => runNow.mutateAsync())} title="Rescan every company now and send the summary">
            <Play /> Run daily scan now
          </Button>
          <Button variant="outline" size="sm" disabled={remindNow.isPending || dirty} onClick={() => remindNow.mutate()} title="Send the closing-soon alerts now, from the results already saved">
            <Clock /> {remindNow.isPending ? "Sending…" : "Send closing alerts now"}
          </Button>
          {!data?.legacyRecheck?.done && <Button variant="outline" size="sm" disabled={recheck.isPending || job?.running || scanAccess.busy} onClick={() => void scanAccess.run(() => recheck.mutateAsync())}>Recheck older results</Button>}
          {recheck.isError && <Badge variant="destructive">{recheck.error.message}</Badge>}
          {remindNow.isSuccess && <Badge>{remindNow.data.result}</Badge>}
          {remindNow.isError && <Badge variant="destructive">{remindNow.error.message}</Badge>}
          {test.isSuccess && <Badge>Sent to {test.data.topic}</Badge>}
          {test.isError && <Badge variant="destructive">{test.error.message}</Badge>}
          {runNow.isError && <Badge variant="destructive">{runNow.error.message}</Badge>}
          {save.isError && <Badge variant="destructive">{save.error.message}</Badge>}
        </div>

        {data && (
          <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
            {job?.running ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Running</Badge>
                <span>
                  {job.done}/{job.total} {job.kind === "recheck" ? "older results rechecked" : "companies scanned"}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Next run:</span>
                <span>{data.nextRunAt ? (new Date(data.nextRunAt) <= new Date() ? "due now" : when(data.nextRunAt)) : "off"}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-x-2">
              <span className="text-muted-foreground">Last run:</span>
              <span>{when(data.lastDailyRunAt)}</span>
              {data.lastDailyRunResult && <span className="text-muted-foreground">— {data.lastDailyRunResult}</span>}
            </div>
            {data.legacyRecheck && <p className="text-muted-foreground">Older results: {data.legacyRecheck.total - data.legacyRecheck.remaining}/{data.legacyRecheck.total} checked · {data.legacyRecheck.confirmed} confirmed · {data.legacyRecheck.inconclusive} inconclusive · {data.legacyRecheck.errors} failed{data.legacyRecheck.done ? " · finished" : job?.running && job.kind === "recheck" ? " · running" : " · waiting to resume"}</p>}
            {data.closingRemindersEnabled && (
              <div className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">Closing alerts:</span>
                <span>{data.lastRemindersAt ? `last sent ${when(data.lastRemindersAt)}` : "none sent yet"}</span>
                {data.lastRemindersResult && <span className="text-muted-foreground">— {data.lastRemindersResult}</span>}
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Scans run three companies at a time. Difficult checks can take up to eight minutes per company; incomplete checks retain the last confirmed result.
        </p>
      </CardContent>
    </Card>
  );
}
