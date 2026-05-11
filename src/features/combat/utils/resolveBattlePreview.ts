export function previewBattleOutcome(attackerStrength: number, defenderStrength: number) {
  const attackerPower = attackerStrength;
  const defenderPower = defenderStrength * 2;
  const delta = attackerPower - defenderPower;

  if (delta > 0) return "attacker-advantage";
  if (delta < 0) return "defender-advantage";
  return "even";
}
