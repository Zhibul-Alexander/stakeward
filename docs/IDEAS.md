# Stakeward: future ideas

Ideas that reuse the same mechanism (stake lockup + custodian). None of them is for the 13 October 2026 demo; at most
one roadmap slide. Each needs a decision before any work starts. Recorded 11 October 2026.

## Mechanism limits to keep in mind

- A lockup blocks Withdraw and changing the withdrawer. It does not block Deactivate, DelegateStake, Split or changing
  the staker. The withdrawer can always reassign the staker, so "you cannot unstake yourself" is impossible without an
  on-chain program. What is possible is "you cannot withdraw SOL until T".
- A custodian without a private key (an off-curve address) cannot sign, so SetLockupChecked does not work: it needs
  SetLockup without the custodian's signature. Today that path exists only for F8 (Squads), behind a typed confirmation.
- With a keyless custodian there is no extension, no early unlock and no rescue: if the main key is stolen, the thief
  waits until T.

## Candidates

1. **Self-lock.** The custodian is an address nobody holds a key for, so the SOL cannot be withdrawn until T by anyone,
   including the owner. A commitment ("I will not sell before spring") and protection against panic or coercion.
   Trade-off: no rescue and no early exit.
2. **Public validator self-bond.** A validator locks its own stake and proves it on-chain: a trust badge for delegators.
   Pairs with validator-health alerts (D128).
3. **SOL vesting without a program.** A company or DAO gives an employee a stake account with the company as custodian.
   The employee earns rewards and can redelegate, but cannot withdraw before the date.
4. **DAO or fund treasury with Squads as custodian** (F8 in CLAUDE.md).
5. **Proof of locked team SOL.** A public page "X SOL locked until T", checked against the chain, for project teams.
6. **Trusted person as the second key** (family, lawyer). Same mechanism as today, different framing.

## Open questions

- Who is the self-lock for: a private holder protecting themselves from themselves, or someone who must prove publicly
  that SOL is locked (validator, project team)? Current lean: public proof, because it can feed the Teams tier
  (see BUSINESS-MODEL.md).
