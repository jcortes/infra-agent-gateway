package main

import rego.v1

container := {
	"name": "web",
	"image": "nginx:1.27",
	"resources": {"limits": {"cpu": "250m", "memory": "128Mi"}},
}

deployment(namespace, c) := {
	"apiVersion": "apps/v1",
	"kind": "Deployment",
	"metadata": {"name": "web", "namespace": namespace},
	"spec": {"template": {"spec": {"containers": [c]}}},
}

test_privileged_container_is_denied if {
	deny["deployment/team-apps/web: container web must not run privileged"] with input as deployment("team-apps", object.union(container, {"securityContext": {"privileged": true}}))
}

test_missing_memory_limit_is_denied if {
	deny["deployment/team-apps/web: container web needs a memory limit"] with input as deployment("team-apps", object.union(object.remove(container, ["resources"]), {"resources": {"limits": {"cpu": "250m"}}}))
}

test_missing_cpu_limit_is_denied if {
	deny["deployment/team-apps/web: container web needs a cpu limit"] with input as deployment("team-apps", object.remove(container, ["resources"]))
}

test_namespace_outside_the_allowlist_is_denied if {
	deny["deployment/kube-system/web: namespace kube-system is not allowed (allowed: team-apps, team-data)"] with input as deployment("kube-system", container)
}

test_compliant_deployment_passes if {
	count(deny) == 0 with input as deployment("team-data", container)
}
