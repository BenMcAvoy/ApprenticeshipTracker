import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

    const isDocx = file.name.toLowerCase().endsWith(".docx");
    if (!isDocx) {
      setValidationError("Choose a .docx file (Microsoft Word document). Other file types aren’t supported.");
      input.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setValidationError("This file is larger than 5 MiB. Choose a smaller .docx file.");
      input.value = "";
      return;
    }

    setIsReading(true);
    try {
      const base64 = await toBase64(file);
      upload.mutate({ fileName: file.name, base64 });
    } catch {
      setValidationError("We couldn’t read this file. Try choosing it again or save it as a new .docx file.");
    } finally {
      setIsReading(false);
      // Clearing the value lets the user select this same file again after an error.
      input.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4" /> Your CV
        </CardTitle>
        <CardDescription>
          Your CV helps tailor applications for open apprenticeships. Tailoring only reorders and rewords your experience; it never adds facts you
          haven’t provided.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {profile.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">Loading your CV…</p>
          ) : profile.isError ? (
            <p role="alert" className="text-sm text-destructive">Couldn’t load your CV: {profile.error.message}</p>
          ) : hasCv ? (
            <>
              <Badge variant="secondary">CV ready</Badge>
              {profile.data.updatedAt && (
                <span className="text-xs text-muted-foreground">
                  Last updated {new Date(profile.data.updatedAt).toLocaleString()}
                </span>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Upload a CV to get started.</p>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-label={hasCv ? "Choose a DOCX file to replace your CV" : "Choose a DOCX file for your CV"}
          disabled={busy || profile.isError}
          className="sr-only"
          onChange={handleFileChange}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || profile.isError}
            onClick={() => fileInput.current?.click()}
          >
            <Upload /> {isReading ? "Reading…" : upload.isPending ? "Uploading…" : hasCv ? "Replace CV" : "Upload DOCX"}
          </Button>
          {isReading && <p role="status" className="text-sm text-muted-foreground">Reading your file…</p>}
          {upload.isPending && <p role="status" className="text-sm text-muted-foreground">Uploading and saving your CV…</p>}
          {upload.isSuccess && <p role="status" className="text-sm text-muted-foreground">Your CV was saved and is ready to use.</p>}
        </div>
        <p className="text-xs text-muted-foreground">Word document (.docx), up to 5 MiB. Saved automatically.</p>

        {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
        {upload.isError && <p role="alert" className="text-sm text-destructive">Couldn’t upload your CV: {upload.error.message}</p>}
      </CardContent>
    </Card>
  );
}
