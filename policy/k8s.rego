# Guardrails for workloads, evaluated against the Deployment the gateway
# renders before it can be queued for approval. Same package as plan.rego so
# one `conftest test` covers both; each rule matches only its own input shape.
package main

import rego.v1

allowed_namespaces := {"team-apps", "team-data"}

workload := sprintf("deployment/%s/%s", [input.metadata.namespace, input.metadata.name]) if input.kind == "Deployment"

containers contains c if {
	input.kind == "Deployment"
	some c in input.spec.template.spec.containers
}

deny contains msg if {
	some c in containers
	c.securityContext.privileged == true
	msg := sprintf("%s: container %s must not run privileged", [workload, c.name])
}

deny contains msg if {
	some c in containers
	some resource in ["cpu", "memory"]
	not c.resources.limits[resource]
	msg := sprintf("%s: container %s needs a %s limit", [workload, c.name, resource])
}

deny contains msg if {
	input.kind == "Deployment"
	not input.metadata.namespace in allowed_namespaces
	msg := sprintf("%s: namespace %s is not allowed (allowed: team-apps, team-data)", [workload, input.metadata.namespace])
}
