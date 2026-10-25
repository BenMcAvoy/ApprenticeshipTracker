import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTRPC } from "@/lib/trpc";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function CvCard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const profile = useQuery({ ...trpc.profile.get.queryOptions(), refetchOnWindowFocus: "always" });
  const upload = useMutation(
    trpc.profile.upload.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.profile.get.queryFilter());
      },
    }),
  );
  const hasCv = Boolean(profile.data?.cvText.trim());
  const busy = profile.isPending || upload.isPending || isReading;

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setValidationError(null);
    upload.reset();

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setValidationError("Choose a .docx file.");
      input.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setValidationError("Over 5 MB.");
      input.value = "";
      return;
    }

    setIsReading(true);
    try {
      const base64 = await toBase64(file);
      upload.mutate({ fileName: file.name, base64 });
    } catch {
      setValidationError("Couldn’t read that file.");
    } finally {
      setIsReading(false);
      // Clearing the value lets the user select this same file again after an error.
      input.value = "";
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>CV</CardTitle>
        {profile.data?.updatedAt && (
          <span className="text-xs text-muted-foreground">Saved {new Date(profile.data.updatedAt).toLocaleDateString("en-GB")}</span>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {profile.isPending && <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
        {profile.isError && <p role="alert" className="text-sm text-destructive">{profile.error.message}</p>}
        {!profile.isPending && !profile.isError && !hasCv && <p className="text-sm text-muted-foreground">No CV yet.</p>}

        <input
          ref={fileInput}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-label="Choose a .docx file"
          disabled={busy || profile.isError}
          className="sr-only"
          onChange={handleFileChange}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy || profile.isError} onClick={() => fileInput.current?.click()}>
            {isReading || upload.isPending ? "Saving…" : hasCv ? "Replace .docx" : "Upload .docx"}
          </Button>
          {upload.isSuccess && <span role="status" className="text-sm text-muted-foreground">Saved</span>}
        </div>

        {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
        {upload.isError && <p role="alert" className="text-sm text-destructive">{upload.error.message}</p>}
      </CardContent>
    </Card>
  );
}
