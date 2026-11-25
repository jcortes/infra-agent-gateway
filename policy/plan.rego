# Guardrails evaluated against `tofu show -json <plan>` before any plan can be
# queued for approval. Each deny message names the resource address so the
# agent can explain the refusal.
package main

import rego.v1

allowed_instance_types := {"t3.micro", "t3.small", "t3.medium"}

required_tags := {"Owner", "Environment"}

changes contains rc if {
	some rc in input.resource_changes
	not "no-op" in rc.change.actions
}

deny contains msg if {
	some rc in changes
	"delete" in rc.change.actions
	msg := sprintf("%s: agents cannot delete resources", [rc.address])
}

deny contains msg if {
	some rc in changes
	rc.type == "aws_instance"
	some tag in required_tags
	not rc.change.after.tags[tag]
	msg := sprintf("%s: missing required tag %s", [rc.address, tag])
}

deny contains msg if {
	some rc in changes
	rc.type == "aws_instance"
	not rc.change.after.instance_type in allowed_instance_types
	msg := sprintf("%s: instance type %s is not allowed (allowed: t3.micro, t3.small, t3.medium)", [rc.address, rc.change.after.instance_type])
}

deny contains msg if {
	some rc in changes
	rc.change.after.tags.Environment == "prod"
	msg := sprintf("%s: agents cannot change prod; open a PR instead", [rc.address])
}

deny contains msg if {
	some rc in changes
	rc.type == "aws_security_group"
	some rule in rc.change.after.ingress
	rule.from_port <= 22
	rule.to_port >= 22
	"0.0.0.0/0" in rule.cidr_blocks
	msg := sprintf("%s: SSH open to 0.0.0.0/0", [rc.address])
}
