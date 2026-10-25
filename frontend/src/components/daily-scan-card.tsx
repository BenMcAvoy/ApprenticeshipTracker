import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const legacy = data?.legacyRecheck;
  const errors = [save.error, test.error, runNow.error, remindNow.error, recheck.error].filter((error): error is Error => error instanceof Error);

  return (
    <Card>
      {scanAccess.dialog}
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Daily scan</CardTitle>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {enabled ? "On" : "Off"}
          <Switch id="daily-enabled" checked={enabled} onCheckedChange={setEnabled} aria-label="Daily scan" />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="daily-time">Time</Label>
            <Input id="daily-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!enabled} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ntfy-topic">ntfy topic</Label>
            <Input id="ntfy-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="topic-name" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Switch id="reminders-enabled" checked={remindersOn} onCheckedChange={setRemindersOn} />
            <Label htmlFor="reminders-enabled">Closing alerts</Label>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Input
              type="number"
              min={1}
              max={30}
              value={reminderDays}
              onChange={(e) => setReminderDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              disabled={!remindersOn}
              className="h-8 w-16"
              aria-label="Days before closing"
            />
            days before
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
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
          <Button variant="outline" size="sm" disabled={test.isPending || dirty} onClick={() => test.mutate()} title={dirty ? "Save first" : undefined}>
            {test.isPending ? "Sending…" : "Send test"}
          </Button>
          <Button variant="outline" size="sm" disabled={runNow.isPending || job?.running || dirty || scanAccess.busy} onClick={() => void scanAccess.run(() => runNow.mutateAsync())}>
            Run now
          </Button>
          <Button variant="outline" size="sm" disabled={remindNow.isPending || dirty} onClick={() => remindNow.mutate()}>
            {remindNow.isPending ? "Sending…" : "Send alerts"}
          </Button>
          {legacy && !legacy.done && (
            <Button variant="ghost" size="sm" disabled={recheck.isPending || job?.running || scanAccess.busy} onClick={() => void scanAccess.run(() => recheck.mutateAsync())}>
              Recheck older results
            </Button>
          )}
        </div>

        {test.isSuccess && <p role="status" className="text-sm text-muted-foreground">Sent to {test.data.topic}.</p>}
        {remindNow.isSuccess && <p role="status" className="text-sm text-muted-foreground">{remindNow.data.result}</p>}
        {errors.map((error, i) => <p key={i} role="alert" className="text-sm text-destructive">{error.message}</p>)}

        {data && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Next</dt>
            <dd>
              {job?.running
                ? `Running, ${job.done}/${job.total}`
                : data.nextRunAt ? (new Date(data.nextRunAt) <= new Date() ? "Due now" : when(data.nextRunAt)) : "Off"}
            </dd>

            <dt className="text-muted-foreground">Last</dt>
            <dd>
              {when(data.lastDailyRunAt)}
              {data.lastDailyRunResult && <span className="text-muted-foreground"> · {data.lastDailyRunResult}</span>}
            </dd>

            {data.closingRemindersEnabled && <>
              <dt className="text-muted-foreground">Alerts</dt>
              <dd>
                {data.lastRemindersAt ? when(data.lastRemindersAt) : "None sent"}
                {data.lastRemindersResult && <span className="text-muted-foreground"> · {data.lastRemindersResult}</span>}
              </dd>
            </>}

            {legacy && <>
              <dt className="text-muted-foreground">Older</dt>
              <dd>
                {legacy.total - legacy.remaining}/{legacy.total} checked · {legacy.confirmed} confirmed · {legacy.inconclusive} unclear · {legacy.errors} failed
                {legacy.done && <span className="text-muted-foreground"> · done</span>}
              </dd>
            </>}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
