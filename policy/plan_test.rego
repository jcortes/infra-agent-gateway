package main

import rego.v1

vm(after) := {"resource_changes": [{
	"address": "aws_instance.vm",
	"type": "aws_instance",
	"change": {"actions": ["create"], "after": after},
}]}

compliant := {"instance_type": "t3.small", "tags": {"Owner": "data-team", "Environment": "dev", "ManagedBy": "infra-agent-gateway"}}

ssh_rule(cidr) := {"resource_changes": [{
	"address": "aws_security_group.vm",
	"type": "aws_security_group",
	"change": {"actions": ["create"], "after": {"ingress": [{"from_port": 22, "to_port": 22, "cidr_blocks": [cidr]}]}},
}]}

test_compliant_vm_passes if {
	count(deny) == 0 with input as vm(compliant)
}

test_missing_owner_tag_is_denied if {
	deny["aws_instance.vm: missing required tag Owner"] with input as vm({"instance_type": "t3.small", "tags": {"Environment": "dev"}})
}

test_large_instance_type_is_denied if {
	deny["aws_instance.vm: instance type m5.24xlarge is not allowed (allowed: t3.micro, t3.small, t3.medium)"] with input as vm(object.union(compliant, {"instance_type": "m5.24xlarge"}))
}

test_prod_is_denied_for_agents if {
	deny["aws_instance.vm: agents cannot change prod; open a PR instead"] with input as vm(object.union(compliant, {"tags": {"Owner": "x", "Environment": "prod"}}))
}

test_ssh_from_internet_is_denied if {
	deny["aws_security_group.vm: SSH open to 0.0.0.0/0"] with input as ssh_rule("0.0.0.0/0")
}

test_ssh_from_office_range_passes if {
	count(deny) == 0 with input as ssh_rule("10.20.0.0/16")
}

test_deletes_are_denied if {
	deny["aws_instance.vm: agents cannot delete resources"] with input as {"resource_changes": [{
		"address": "aws_instance.vm",
		"type": "aws_instance",
		"change": {"actions": ["delete"], "after": null},
	}]}
}
