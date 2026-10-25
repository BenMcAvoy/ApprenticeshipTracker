import assert from "node:assert/strict";
import test from "node:test";
import { scanNotice } from "../src/lib/scan-notice.ts";
import type { CompanyRow } from "../src/components/company-card.tsx";

const company: CompanyRow = { id: 1, name: "Example", status: "open", summary: "Verified role", listings: "[]", evidence: "[]", checked: 2, careersUrl: null, lastScannedAt: null };
test("confirmed results visibly distinguish a failed recheck", () => {
  const notice = scanNotice({ ...company, lastAttemptStatus: "unclear", lastConfirmedAt: "2026-10-20T12:00:00Z" });
  assert.equal(notice?.retained, true);
  assert.match(notice!.message, /inconclusive.*last confirmed/);
  assert.equal(scanNotice({ ...company, status: "unclear", lastAttemptStatus: "unclear" }), null);
});
test("partial current results show discovery limits without claiming failed verification", () => {
  const notice = scanNotice({ ...company, scanVersion: 2, coverageComplete: false });
  assert.equal(notice?.retained, false);
  assert.match(notice!.message, /vacancy search is incomplete/);
  assert.equal(scanNotice({ ...company, scanVersion: 2, coverageComplete: true }), null);
});
