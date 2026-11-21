import { describe, expect, it } from "vitest";
import type { ChoiceInteraction } from "@ivf/core";
import { findBlockedSeekTarget, findDueInteraction, orderedInteractions } from "../src/timeline";

const interactions: ChoiceInteraction[] = [
  { id: "later", at_seconds: 20, type: "choice", prompt: "Later", options: [] },
  { id: "first", at_seconds: 10, type: "choice", prompt: "First", options: [] },
];

describe("timeline", () => {
  it("orders interactions by timestamp", () => {
    expect(orderedInteractions(interactions).map((item) => item.id)).toEqual(["first", "later"]);
  });

  it("finds only unresolved interactions that are due", () => {
    expect(findDueInteraction(interactions, 9, new Set())?.id).toBeUndefined();
    expect(findDueInteraction(interactions, 10, new Set())?.id).toBe("first");
    expect(findDueInteraction(interactions, 10, new Set(["first"]))?.id).toBeUndefined();
  });

  it("blocks seeking past unresolved interactions", () => {
    expect(findBlockedSeekTarget(interactions, 15, new Set())).toBe(10);
    expect(findBlockedSeekTarget(interactions, 15, new Set(["first"]))).toBeUndefined();
    expect(findBlockedSeekTarget(interactions, 25, new Set(["first"]))).toBe(20);
    expect(findBlockedSeekTarget(interactions, 25, new Set(["first", "later"]))).toBeUndefined();
  });
});
