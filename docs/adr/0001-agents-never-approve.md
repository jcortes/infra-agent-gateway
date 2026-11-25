# 0001: Agents can plan and request, never approve

**Status:** accepted

The MCP server exposes `plan_change`, `request_apply` and `get_audit_log`. There is no approve tool. Applying a change takes a human running `pnpm approve <planId>` in a separate process, and the gateway also refuses any approver whose id doesn't start with `human:`.

**Why two layers:** the missing tool means a prompt-injected agent has nothing to call. The approver check catches a future change that wires `approve` into an agent-facing surface by mistake.

**Consequence:** an apply always has a named human in the audit log. Low-risk auto-apply (e.g. dev-only, under a cost ceiling) would be a deliberate policy decision recorded in a new ADR, not a code shortcut.
