# AI repair and test-protection policy

## Allowed

- Read failure evidence: stack, trace, screenshot, console, network, DOM.
- Classify the failure before changing code.
- Propose a minimal patch in an isolated branch/worktree.
- Run the failing test, adjacent regression, full P0 set and build.
- Stop after two repair rounds and produce a reproduction package.

## Forbidden

- Deleting or weakening assertions.
- Turning a failing test into `skip`, `fixme`, `test.fail` or a conditional
  no-op without a reviewed product/test reason.
- Widening ignore lists, lowering thresholds, masking whole screenshots or
  auto-approving baselines to get green.
- Deleting product behavior instead of fixing the defect.
- Editing the quality gate or CI to bypass a failure.
- Production writes, real payments, bulk messages or secret changes.

## Required repair record

```json
{
  "failureId": "test-or-issue-id",
  "classification": "product|test|environment|data|external|intended",
  "rootCauseHypothesis": "one paragraph",
  "evidence": ["trace path", "screenshot path", "stack line"],
  "changedFiles": ["..."],
  "whyTestStillCatchesDefect": "one paragraph",
  "verification": ["failing test", "adjacent regression", "full P0 gate"],
  "residualRisk": "known limits"
}
```

The final release approval belongs to a human. Automation may prove facts; it
does not own the product decision.
