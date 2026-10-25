import { createFileRoute } from "@tanstack/react-router";
import { AppliedHistoryCard } from "@/components/applied-history-card";

export const Route = createFileRoute("/applications")({ component: Applications });

function Applications() {
  return <AppliedHistoryCard />;
}
