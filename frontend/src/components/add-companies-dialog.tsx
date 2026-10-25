import { Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { parseCompanies, type ParsedCompany } from "@/lib/parse-companies";

export function AddCompaniesDialog({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (companies: ParsedCompany[]) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const count = parseCompanies(text).length;

  async function loadFile(file: File | undefined) {
    if (!file) return;
    const contents = await file.text();
    setText((current) => (current.trim() ? `${current.trimEnd()}\n${contents}` : contents));
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit() {
    await onAdd(parseCompanies(text));
    setText("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="h-11 md:h-7" aria-label="Add companies" />}>
        <Plus /> Add<span className="hidden md:inline"> companies</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add companies</DialogTitle>
          <DialogDescription>
            One company per line. Optionally add its careers page after a comma, e.g.{" "}
            <code>Acme, https://acme.com/careers</code>.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Rolls-Royce\nBT Group\nAcme, https://acme.com/careers"}
        />

        <input
          ref={fileInput}
          type="file"
          accept=".txt,.csv,text/plain,text/csv"
          className="hidden"
          onChange={(e) => loadFile(e.target.files?.[0])}
        />
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => fileInput.current?.click()}>
            <Upload /> Choose file
          </Button>
          <Button disabled={!count || pending} onClick={submit}>
            Add {count || ""} {count === 1 ? "company" : "companies"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
