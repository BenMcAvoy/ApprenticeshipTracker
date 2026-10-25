import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service connections</CardTitle>
        <CardDescription>The shared ChatGPT connection powers scans and members' tailored applications.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span>Backend → DB</span>
          {ping.isPending && <Badge variant="secondary">pinging…</Badge>}
          {ping.isError && <Badge variant="destructive">down</Badge>}
          {ping.data && <Badge>{ping.data.db}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <span>ChatGPT</span>
          {signedIn ? (
            <>
              <Badge>signed in</Badge>
              <Button variant="outline" size="sm" onClick={() => check.mutate()}>
                Test AI
              </Button>
              <input
                ref={imageInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onImage(e.target.files?.[0])}
              />
              <Button variant="outline" size="sm" onClick={() => imageInput.current?.click()}>
                Test image
              </Button>
              <Button variant="ghost" size="sm" onClick={() => logout.mutate()}>
                Disconnect ChatGPT
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={login.isPending || loggingIn} onClick={() => login.mutate()}>
                {loggingIn ? "Waiting for login…" : "Sign in with ChatGPT"}
              </Button>
              {status.data?.error && <Badge variant="destructive">{status.data.error}</Badge>}
              {login.isError && <Badge variant="destructive">{login.error.message}</Badge>}
            </>
          )}
        </div>
        {check.isPending && <Badge variant="secondary">thinking…</Badge>}
        {check.isError && <Badge variant="destructive">{check.error.message}</Badge>}
        {describe.isPending && <Badge variant="secondary">looking…</Badge>}
        {describe.isError && <Badge variant="destructive">{describe.error.message}</Badge>}
        {describe.data && <p className="text-sm">{describe.data.description}</p>}
        {check.data && <Badge>AI says: {check.data.reply}</Badge>}
      </CardContent>
    </Card>
  );
}
