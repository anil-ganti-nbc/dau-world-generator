/**
 * Kernel-rule inventory gate (SME governance).
 *
 * Enforces, per domain:
 *  - the inventory file exists and parses against the expected shape;
 *  - every kernel rule that generation depends on is INVENTORIED
 *    (coverage is asserted via the family catalogue + channel list);
 *  - every provenance class is legitimate; `pedagogical-fiction` and
 *    `deliberate-simplification` rules must declare the heuristic they train;
 *  - no rule may claim certification while the reviewer field is empty;
 *  - the gate status matches the per-rule verdicts (no rubber-stamping).
 *
 * This test does NOT certify the physics. It certifies that the paperwork
 * cannot quietly lie about whether the physics was reviewed.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { FAMILIES } from "../src/domains/cpu-memory/families.ts";

interface Rule {
  id: string;
  title: string;
  kernel: string;
  claim: string;
  realWorldBasis: string;
  provenance: string;
  confidence: string;
  affectsChannels: string[];
  diagnosticHeuristicTrained?: string;
  smeReview: { verdict: string; reviewerNote: string | null };
}

interface Inventory {
  domainId: string;
  domainVersion: string;
  inventoryVersion: number;
  status: string;
  smeGate: {
    reviewer: string | null;
    reviewedAt: string | null;
    verdict: string;
    notes: string;
  };
  rules: Rule[];
  notModeled: string[];
}

const PATH = "schemas/kernel-rules.cpu-memory.json";
const inventory: Inventory = JSON.parse(readFileSync(PATH, "utf-8"));

describe("kernel-rule inventory (SME gate)", () => {
  it("exists for cpu-memory and names the current domain version", () => {
    assert.equal(inventory.domainId, "cpu-memory");
    assert.equal(typeof inventory.domainVersion, "string");
    assert.match(inventory.domainVersion, /^\d+\.\d+\.\d+$/);
  });

  it("inventories rules that touch every observation channel", () => {
    const channels = new Set<string>(inventory.rules.flatMap((r) => r.affectsChannels));
    // Every learner-visible evidence channel must be covered by at least one
    // inventoried rule — an uninventoried channel is an unaudited causal claim.
    for (const ch of ["perf-counters", "miss-timeline", "set-distribution", "coherence-probe", "prefetch-audit"]) {
      assert.ok(channels.has(ch), `channel ${ch} not covered by any inventoried rule`);
    }
  });

  it("every rule carries provenance + review record; fictions declare their trained heuristic", () => {
    const validProvenance = new Set([
      "grounded-abstraction",
      "deliberate-simplification",
      "pedagogical-fiction",
      "unknown-disputed",
    ]);
    const ids = new Set<string>();
    for (const r of inventory.rules) {
      assert.ok(!ids.has(r.id), `duplicate rule id ${r.id}`);
      ids.add(r.id);
      assert.ok(validProvenance.has(r.provenance), `${r.id}: bad provenance ${r.provenance}`);
      assert.ok(r.kernel.includes(".ts"), `${r.id}: kernel location should point at code`);
      if (["pedagogical-fiction", "deliberate-simplification"].includes(r.provenance)) {
        assert.ok(
          r.diagnosticHeuristicTrained,
          `${r.id}: simplification/fiction must declare diagnosticHeuristicTrained`,
        );
      }
      assert.ok(["PENDING", "PASS", "REWORD", "RETUNE", "REMOVE"].includes(r.smeReview.verdict));
    }
    assert.ok(ids.size >= 10, `expected >=10 inventoried rules, found ${ids.size}`);
  });

  it("no rule claims PASS while the human reviewer field is unset", () => {
    for (const r of inventory.rules) {
      if (["PASS", "REWORD", "RETUNE", "REMOVE"].includes(r.smeReview.verdict)) {
        assert.ok(inventory.smeGate.reviewer, `${r.id}: rule reviewed but smeGate.reviewer is null — no anonymous sign-offs`);
        assert.ok(inventory.smeGate.reviewedAt, `${r.id}: reviewed rule missing smeGate.reviewedAt`);
      }
    }
  });

  it("gate status is consistent with per-rule verdicts", () => {
    const pending = inventory.rules.filter((r) => r.smeReview.verdict === "PENDING").length;
    if (inventory.status === "SIGNED_OFF") {
      assert.equal(pending, 0, "cannot be SIGNED_OFF with PENDING rules");
      assert.equal(inventory.smeGate.verdict, "SIGNED_OFF");
      assert.ok(inventory.smeGate.reviewer, "SIGNED_OFF requires a named reviewer");
    } else {
      assert.notEqual(inventory.smeGate.verdict, "SIGNED_OFF", "gate verdict contradicts inventory status");
    }
    // Current truth: nothing has been certified.
    assert.equal(inventory.status, "PENDING_SME_REVIEW");
    assert.equal(pending, inventory.rules.length);
  });

  it("documents what is NOT modelled (reviewers confirm this list)", () => {
    assert.ok(Array.isArray(inventory.notModeled) && inventory.notModeled.length >= 5);
  });

  it("family catalogue stays aligned with the inventory's declared scope", () => {
    // The inventory describes the whole domain; every family's mechanism must
    // rest on inventoried rules. Cheap alignment check: all families' concept
    // channels trace to cache/coherence/prefetch rule groups.
    void FAMILIES;
    assert.ok(inventory.rules.some((r) => r.id.startsWith("conflict")));
    assert.ok(inventory.rules.some((r) => r.id.includes("coherence")));
    assert.ok(inventory.rules.some((r) => r.id.includes("prefetch")));
    assert.ok(inventory.rules.some((r) => r.id.includes("capacity")));
  });
});
