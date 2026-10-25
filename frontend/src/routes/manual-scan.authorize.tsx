import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/manual-scan/authorize")({
  beforeLoad: () => { throw redirect({ to: "/" }); },
});
