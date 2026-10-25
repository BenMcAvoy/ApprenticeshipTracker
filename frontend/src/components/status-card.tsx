import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTRPC } from "@/lib/trpc";

export function StatusCard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const ping = useQuery(trpc.ping.queryOptions());
  const [loggingIn, setLoggingIn] = useState(false);
  const status = useQuery({
    ...trpc.ai.status.queryOptions(),
    refetchInterval: loggingIn ? 2000 : false,
  });
  const refreshStatus = () => queryClient.invalidateQueries(trpc.ai.status.queryFilter());
  const login = useMutation(
    trpc.ai.login.mutationOptions({
      onSuccess: ({ url }) => {
        setLoggingIn(true);
        window.open(url, "_blank");
      },
    }),
  );
  const logout = useMutation(trpc.ai.logout.mutationOptions({ onSuccess: refreshStatus }));
  const check = useMutation(trpc.ai.check.mutationOptions());
  const imageInput = useRef<HTMLInputElement>(null);
  const describe = useMutation(trpc.ai.describeImage.mutationOptions());
  const signedIn = status.data?.signedIn;

  async function onImage(file: File | undefined) {
    if (!file) return;
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of buffer) binary += String.fromCharCode(byte);
    describe.mutate({ image: btoa(binary), mediaType: file.type });
    if (imageInput.current) imageInput.current.value = "";
  }

  // Stop polling once login completes or the backend reports a failure.
  useEffect(() => {
    if (signedIn || status.data?.error) setLoggingIn(false);
  }, [signedIn, status.data?.error]);

  const errors = [ping.error, login.error, check.error, describe.error].flatMap((error) => (error ? [error.message] : []));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>ChatGPT</CardTitle>
        {signedIn ? <Badge>Connected</Badge> : <Badge variant="secondary">Not connected</Badge>}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {signedIn ? (
            <>
              <Button variant="outline" size="sm" disabled={check.isPending} onClick={() => check.mutate()}>
                {check.isPending ? "Testing…" : "Test"}
              </Button>
              <input ref={imageInput} type="file" accept="image/*" className="hidden" onChange={(e) => onImage(e.target.files?.[0])} />
              <Button variant="outline" size="sm" disabled={describe.isPending} onClick={() => imageInput.current?.click()}>
                {describe.isPending ? "Testing…" : "Test image"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => logout.mutate()}>Sign out</Button>
            </>
          ) : (
            <Button size="sm" disabled={login.isPending || loggingIn} onClick={() => login.mutate()}>
              {loggingIn ? "Waiting…" : "Connect"}
            </Button>
          )}
        </div>

        {check.data && <p className="text-sm">{check.data.reply}</p>}
        {describe.data && <p className="text-sm">{describe.data.description}</p>}
        {status.data?.error && <p role="alert" className="text-sm text-destructive">{String(status.data.error)}</p>}
        {errors.map((message, i) => <p key={i} role="alert" className="text-sm text-destructive">{message}</p>)}
        {ping.data && <p className="text-xs text-muted-foreground">Database {ping.data.db}</p>}
      </CardContent>
    </Card>
  );
}
