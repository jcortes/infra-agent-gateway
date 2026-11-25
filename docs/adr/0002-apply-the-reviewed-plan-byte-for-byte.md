# 0002: Apply the reviewed plan byte for byte

**Status:** accepted

`plan_change` saves the plan with `tofu plan -out` and stores its sha256. `approve` recomputes the hash and refuses on mismatch, then runs `tofu apply <planfile>`, never a fresh plan.

**Why:** what the policies checked and the human read must be exactly what runs. Re-planning at apply time would let infrastructure drift or a swapped file change the outcome after review.

**Consequence:** a stale plan (state moved on) fails at apply and the agent must re-plan. That is the intended behaviour.
