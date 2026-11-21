import type { ChoiceInteraction } from "@ivf/core";

export function orderedInteractions(interactions: readonly ChoiceInteraction[]): ChoiceInteraction[] {
  return [...interactions].sort((left, right) => left.at_seconds - right.at_seconds);
}

export function findDueInteraction(
  interactions: readonly ChoiceInteraction[],
  currentSeconds: number,
  resolvedIds: ReadonlySet<string>,
): ChoiceInteraction | undefined {
  return orderedInteractions(interactions).find(
    (interaction) =>
      !resolvedIds.has(interaction.id) &&
      interaction.at_seconds <= currentSeconds,
  );
}

export function findBlockedSeekTarget(
  interactions: readonly ChoiceInteraction[],
  targetSeconds: number,
  resolvedIds: ReadonlySet<string>,
): number | undefined {
  const unresolved = orderedInteractions(interactions).find(
    (interaction) =>
      !resolvedIds.has(interaction.id) &&
      interaction.at_seconds < targetSeconds,
  );
  return unresolved?.at_seconds;
}
