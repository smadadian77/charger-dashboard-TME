import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.services.kubernetes_service import (
    KubernetesReadError,
    _CREDENTIAL_STATUS_CACHE,
    _enrich_nodes_with_aws,
    _environment_cluster,
    _environment_profile,
    credential_status,
    get_node_infrastructure,
    get_pod_logs,
    list_pods,
    start_pod_terminal,
    start_sso_login,
)


class KubernetesServiceTests(unittest.TestCase):
    backend_namespace = "tme-ns-ev-backend-prd"
    gateway_namespace = "tme-ns-ev-virtual-gateway-prd"

    def setUp(self):
        _CREDENTIAL_STATUS_CACHE.clear()

    @patch("backend.services.kubernetes_service.subprocess.run")
    def test_credential_status_checks_only_the_allowlisted_profile(self, run):
        run.return_value = SimpleNamespace(returncode=0, stdout='{"Account":"123456789012","Arn":"arn:aws:sts::123456789012:assumed-role/ReadOnly/alice"}')

        status = credential_status("prod")

        self.assertEqual(status["status"], "ready")
        self.assertEqual(status["principal"], "alice")
        self.assertEqual(
            run.call_args.args[0],
            ["aws", "sts", "get-caller-identity", "--profile", "EKS-ReadOnly-067615905898", "--output", "json"],
        )

    def test_environment_profiles_and_namespace_clusters_are_scoped(self):
        environments = {
            "dev": ("EKS-ReadOnly-465636357526", "tme-ns-ev-backend-dev", "ev-backend-eks-dev"),
            "prev": ("EKS-ReadOnly-106643736876", "tme-ns-ev-backend-prev", "ev-backend-eks-prev"),
            "acc": ("EKS-ReadOnly-171020041320", "tme-ns-ev-backend-uat", "ev-backend-eks-acc"),
            "prod": ("EKS-ReadOnly-067615905898", self.backend_namespace, "ev-backend-eks-prod"),
        }
        for env, (profile, namespace, cluster) in environments.items():
            with self.subTest(env=env):
                self.assertEqual(_environment_profile(env), profile)
                self.assertEqual(_environment_cluster(env, namespace), cluster)
        with self.assertRaises(KubernetesReadError):
            _environment_cluster("acc", "tme-ns-ev-backend-dev")

    @patch("backend.services.kubernetes_service._run_command")
    def test_successful_credential_status_is_cached_per_environment(self, run_command):
        run_command.return_value = SimpleNamespace(
            returncode=0,
            stdout='{"Account":"465636357526","Arn":"arn:aws:sts::465636357526:assumed-role/ReadOnly/user"}',
        )

        first = credential_status("dev")
        second = credential_status("dev")

        self.assertTrue(first["authenticated"])
        self.assertEqual(second["env"], "dev")
        run_command.assert_called_once()

    @patch("backend.services.kubernetes_service.subprocess.Popen")
    def test_sso_login_uses_allowlisted_profile_without_waiting(self, popen):
        popen.return_value.poll.return_value = None

        result = start_sso_login("prod")

        self.assertTrue(result["started"])
        self.assertEqual(popen.call_args.args[0], ["aws", "sso", "login", "--profile", "EKS-ReadOnly-067615905898"])

    @patch("backend.services.kubernetes_service.subprocess.run")
    def test_missing_credentials_are_reported_without_running_kubectl(self, run):
        run.return_value = SimpleNamespace(returncode=1, stdout="", stderr="SSO session expired")

        with self.assertRaises(KubernetesReadError) as error:
            list_pods("prod", "all")

        self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(run.call_count, 1)

    @patch("backend.services.kubernetes_service.subprocess.run")
    def test_live_queries_are_limited_to_the_selected_namespace(self, run):
        pod_data = {
            "items": [
                {
                    "metadata": {
                        "namespace": self.backend_namespace,
                        "name": "api-0",
                        "creationTimestamp": "2026-10-04T10:00:00Z",
                        "labels": {"app": "payments"},
                        "ownerReferences": [{"kind": "ReplicaSet", "name": "api-rs"}],
                    },
                    "spec": {"nodeName": "ip-10-0-0-1", "containers": [{"name": "api", "image": "example/api:1", "resources": {"requests": {"cpu": "100m"}, "limits": {"memory": "512Mi"}}, "readinessProbe": {"periodSeconds": 5}}]},
                    "status": {
                        "phase": "Running",
                        "podIP": "10.0.0.8",
                        "qosClass": "Burstable",
                        "conditions": [{"type": "Ready", "status": "False", "reason": "ReadinessGatesNotReady"}],
                        "containerStatuses": [{"name": "api", "ready": True, "restartCount": 2, "state": {"running": {"startedAt": "2026-10-04T10:00:01Z"}}, "lastState": {"terminated": {"reason": "Error", "exitCode": 1, "finishedAt": "2026-10-04T10:01:00Z"}}}],
                    },
                },
            ]
        }
        deployments_data = {"items": [{"metadata": {"name": "api", "labels": {"github-repository": "payments", "environment": "prd"}}, "spec": {"replicas": 3, "selector": {"matchLabels": {"app": "payments-api"}}}, "status": {"readyReplicas": 2, "availableReplicas": 2, "updatedReplicas": 3}}]}
        replicasets_data = {"items": [{"metadata": {"name": "api-rs", "ownerReferences": [{"kind": "Deployment", "name": "api"}]}}]}
        node_data = {"metadata": {"name": "ip-10-0-0-1", "labels": {"topology.kubernetes.io/zone": "eu-west-1a"}}, "spec": {"providerID": "aws:///eu-west-1a/i-0123456789abcdef0"}, "status": {"conditions": [{"type": "Ready", "status": "True"}]}}
        events_data = {"items": [{"metadata": {"namespace": self.backend_namespace, "creationTimestamp": "2026-10-04T11:00:00Z"}, "type": "Warning", "reason": "BackOff", "message": "Container restart back-off", "count": 2, "involvedObject": {"kind": "Pod", "name": "api-0", "namespace": self.backend_namespace}, "source": {"component": "kubelet"}}]}

        def command_result(command, **_kwargs):
            if command[:3] == ["aws", "sts", "get-caller-identity"]:
                return SimpleNamespace(returncode=0, stdout='{"Account":"123456789012","Arn":"arn:aws:sts::123456789012:assumed-role/ReadOnly/alice"}')
            if command[:3] == ["aws", "eks", "update-kubeconfig"]:
                return SimpleNamespace(returncode=0, stdout="updated")
            if command[:3] == ["kubectl", "get", "pods"]:
                return SimpleNamespace(returncode=0, stdout=json.dumps(pod_data))
            if command[:3] == ["kubectl", "get", "deployments"]:
                return SimpleNamespace(returncode=0, stdout=json.dumps(deployments_data))
            if command[:3] == ["kubectl", "get", "replicasets"]:
                return SimpleNamespace(returncode=0, stdout=json.dumps(replicasets_data))
            if command[:3] == ["kubectl", "get", "nodes"]:
                return SimpleNamespace(returncode=0, stdout=json.dumps(node_data))
            if command[:3] == ["aws", "ec2", "describe-instances"]:
                return SimpleNamespace(returncode=0, stdout='[["i-0123456789abcdef0","running","eu-west-1a","m6i.large"]]')
            if command[:3] == ["aws", "ec2", "describe-instance-status"]:
                return SimpleNamespace(returncode=0, stdout='[{"InstanceId":"i-0123456789abcdef0","SystemStatus":"ok","InstanceStatus":"ok","Events":[]}]')
            if command[:3] == ["aws", "cloudwatch", "get-metric-data"]:
                return SimpleNamespace(returncode=0, stdout='{"MetricDataResults":[{"Id":"cpu0","Timestamps":["2026-10-04T10:55:00Z"],"Values":[12.5]}]}')
            if command[:3] == ["aws", "cloudwatch", "describe-alarms-for-metric"]:
                return SimpleNamespace(returncode=0, stdout="[]")
            if command[:3] == ["kubectl", "get", "events"]:
                return SimpleNamespace(returncode=0, stdout=json.dumps(events_data))
            if command[:3] == ["kubectl", "top", "pods"]:
                return SimpleNamespace(returncode=0, stdout="api-0 api 250m 120Mi\n")
            self.fail(f"Unexpected command: {command}")

        run.side_effect = command_result

        result = list_pods("prod", self.backend_namespace)

        self.assertEqual(result["namespace"], self.backend_namespace)
        self.assertEqual(result["summary"]["healthy"], 0)
        self.assertEqual(result["summary"]["notReady"], 1)
        self.assertEqual(result["pods"][0]["health"], "Not ready")
        self.assertEqual(result["summary"]["restarts"], 2)
        self.assertEqual(result["pods"][0]["ready"], "1/1")
        self.assertEqual(result["pods"][0]["containers"][0]["image"], "example/api:1")
        self.assertEqual(result["pods"][0]["containers"][0]["requests"]["cpu"], "100m")
        self.assertEqual(result["pods"][0]["containers"][0]["probes"]["readiness"]["periodSeconds"], 5)
        self.assertEqual(result["pods"][0]["containers"][0]["lastReason"], "Error")
        self.assertEqual(result["pods"][0]["owners"][0]["name"], "api")
        self.assertEqual(result["pods"][0]["workload"], "api")
        self.assertEqual(result["deployments"][0]["serviceKey"], "payments")
        self.assertEqual(result["deployments"][0]["module"], "API")
        self.assertEqual(result["deployments"][0]["readyReplicas"], 2)
        self.assertEqual(result["nodes"][0]["instanceId"], "i-0123456789abcdef0")
        self.assertNotIn("aws", result["nodes"][0])
        self.assertFalse(any(call.args[0][:2] == ["aws", "ec2"] for call in run.call_args_list))
        self.assertEqual(result["events"][0]["reason"], "BackOff")
        self.assertEqual(result["summary"]["warningEvents"], 1)
        self.assertEqual(result["metrics"][0]["memory"], "120Mi")
        for resource in ("pods", "events", "deployments", "replicasets"):
            query = next(call.args[0] for call in run.call_args_list if call.args[0][:3] == ["kubectl", "get", resource])
            self.assertIn("--namespace", query)
            self.assertIn(self.backend_namespace, query)
            self.assertNotIn("--all-namespaces", query)

    @patch("backend.services.kubernetes_service.subprocess.run")
    def test_optional_event_and_metrics_access_do_not_fail_pod_inventory(self, run):
        pod_data = {"items": [{"metadata": {"namespace": self.gateway_namespace, "name": "gateway-0"}, "spec": {"containers": [{"name": "gateway"}]}, "status": {"phase": "Running", "containerStatuses": [{"name": "gateway", "ready": True}]}}]}
        def command_result(command, **_kwargs):
            if command[:3] == ["aws", "sts", "get-caller-identity"]:
                return SimpleNamespace(returncode=0, stdout='{"Account":"123456789012","Arn":"arn:aws:sts::123456789012:assumed-role/ReadOnly/alice"}')
            if command[:3] == ["aws", "eks", "update-kubeconfig"]:
                return SimpleNamespace(returncode=0, stdout="updated")
            if command[:3] == ["kubectl", "get", "pods"]:
                return SimpleNamespace(returncode=0, stdout=json.dumps(pod_data))
            return SimpleNamespace(returncode=1, stdout="", stderr="forbidden")

        run.side_effect = command_result

        result = list_pods("prod", self.gateway_namespace)

        self.assertEqual(len(result["pods"]), 1)
        self.assertFalse(result["eventsAvailable"])
        self.assertFalse(result["metricsAvailable"][self.gateway_namespace])
        self.assertFalse(result["namespaces"][0]["availability"]["deployments"])

    @patch("backend.services.kubernetes_service.subprocess.run")
    def test_node_read_timeout_does_not_fail_pod_inventory(self, run):
        pod_data = {"items": [{"metadata": {"namespace": self.backend_namespace, "name": "api-0"}, "spec": {"nodeName": "node-1", "containers": []}, "status": {"phase": "Pending"}}]}

        def command_result(command, **_kwargs):
            if command[:3] == ["aws", "sts", "get-caller-identity"]:
                return SimpleNamespace(returncode=0, stdout='{"Account":"123456789012"}')
            if command[:3] == ["aws", "eks", "update-kubeconfig"]:
                return SimpleNamespace(returncode=0, stdout="updated")
            if command[:3] == ["kubectl", "get", "pods"]:
                return SimpleNamespace(returncode=0, stdout=json.dumps(pod_data))
            if command[:3] in (["kubectl", "get", "deployments"], ["kubectl", "get", "replicasets"], ["kubectl", "get", "events"]):
                return SimpleNamespace(returncode=0, stdout='{"items":[]}')
            if command[:3] == ["kubectl", "top", "pods"]:
                return SimpleNamespace(returncode=1, stdout="", stderr="forbidden")
            if command[:3] == ["kubectl", "get", "nodes"]:
                raise KubernetesReadError(504, "kubectl command timed out.")
            self.fail(f"Unexpected command: {command}")

        run.side_effect = command_result

        result = list_pods("prod", self.backend_namespace)

        self.assertEqual(len(result["pods"]), 1)
        self.assertFalse(result["namespaces"][0]["availability"]["nodes"])
        self.assertIn("nodes", result["namespaces"][0]["errors"])

    @patch("backend.services.kubernetes_service._run_command")
    def test_aws_node_enrichment_uses_only_referenced_instance_ids(self, run_command):
        run_command.side_effect = [
            SimpleNamespace(returncode=0, stdout='[["i-0123456789abcdef0","running","eu-west-1a","m6i.large"]]'),
            SimpleNamespace(returncode=0, stdout='[{"InstanceId":"i-0123456789abcdef0","SystemStatus":"ok","InstanceStatus":"ok","Events":[]}]'),
            SimpleNamespace(returncode=0, stdout='{"MetricDataResults":[{"Id":"cpu0","Timestamps":["2026-10-04T10:55:00Z"],"Values":[12.5]}]}'),
            SimpleNamespace(returncode=0, stdout="[]"),
        ]
        nodes = [{"instanceId": "i-0123456789abcdef0", "name": "node-1"}]

        _enrich_nodes_with_aws(nodes)

        self.assertEqual(nodes[0]["aws"]["state"], "running")
        self.assertEqual(nodes[0]["aws"]["systemStatus"], "ok")
        self.assertEqual(nodes[0]["aws"]["cpu"][0]["value"], 12.5)
        self.assertEqual(nodes[0]["aws"]["alarms"], [])
        self.assertTrue(all("i-0123456789abcdef0" in " ".join(call.args[0]) for call in run_command.call_args_list))

    def test_infrastructure_lookup_is_allowlisted_and_cached(self):
        snapshot = {"namespace": self.backend_namespace, "cluster": "cluster", "nodes": [], "availability": {"nodes": True, "ec2": False, "cloudWatchCpu": False, "alarms": False}, "errors": {}}
        with patch("backend.services.kubernetes_service.credential_status", return_value={"authenticated": True}), \
                patch("backend.services.kubernetes_service._read_namespace_infrastructure", return_value=snapshot) as read_infrastructure, \
                patch("backend.services.kubernetes_service._INFRASTRUCTURE_CACHE", {}):
            first = get_node_infrastructure("prod", self.backend_namespace)
            second = get_node_infrastructure("prod", self.backend_namespace)
            forced = get_node_infrastructure("prod", self.backend_namespace, force=True)
            with self.assertRaises(KubernetesReadError) as error:
                get_node_infrastructure("prod", "kube-system")

        self.assertEqual(first["nodes"], [])
        self.assertEqual(second["namespaces"][0]["namespace"], self.backend_namespace)
        self.assertEqual(forced["namespaces"][0]["namespace"], self.backend_namespace)
        self.assertEqual(read_infrastructure.call_count, 2)
        self.assertEqual(error.exception.status_code, 400)

    @patch("backend.services.kubernetes_service.subprocess.run")
    def test_pod_logs_are_bounded_scoped_and_container_specific(self, run):
        run.side_effect = [
            SimpleNamespace(returncode=0, stdout='{"Account":"123456789012"}', stderr=""),
            SimpleNamespace(returncode=0, stdout="updated", stderr=""),
            SimpleNamespace(returncode=0, stdout="2026-10-04T10:00:00Z app-1 api Error", stderr=""),
        ]

        logs = get_pod_logs("prod", self.backend_namespace, "api-0", "api", previous=True, since="6h")

        self.assertEqual(logs["pod"], "api-0")
        self.assertTrue(logs["previous"])
        command = run.call_args_list[2].args[0]
        self.assertEqual(command[:2], ["kubectl", "logs"])
        self.assertIn("--namespace", command)
        self.assertIn(self.backend_namespace, command)
        self.assertIn("--container", command)
        self.assertIn("--previous=true", command)
        self.assertIn("--since", command)
        self.assertIn("--tail=250", command)
        self.assertIn("--limit-bytes=65536", command)

    def test_terminal_is_authenticated_and_scoped_to_one_allowlisted_container(self):
        process = SimpleNamespace(poll=lambda: None, terminate=lambda: None, wait=lambda **_kwargs: None)
        with patch("backend.services.kubernetes_service.credential_status", return_value={"authenticated": True}), \
                patch("backend.services.kubernetes_service._run_command", return_value=SimpleNamespace(returncode=0)), \
                patch("backend.services.kubernetes_service.subprocess.Popen", return_value=process) as popen:
            session = start_pod_terminal("prod", self.backend_namespace, "api-0", "api")
            temp_dir = session.temp_dir
            command = popen.call_args.args[0]
            self.assertEqual(command[:3], ["kubectl", "exec", "api-0"])
            self.assertIn(self.backend_namespace, command)
            self.assertIn("--stdin", command)
            self.assertIn("--kubeconfig", command)
            self.assertEqual(command[-3:], ["--", "/bin/sh", "-i"])
            self.assertTrue(os.path.isdir(temp_dir))
            session.close()

        self.assertFalse(os.path.exists(temp_dir))

    def test_terminal_rejects_unapproved_scope_and_requires_aws_login(self):
        with self.assertRaises(KubernetesReadError) as error:
            start_pod_terminal("prod", "kube-system", "api-0", "api")
        self.assertEqual(error.exception.status_code, 400)

        with patch("backend.services.kubernetes_service.credential_status", return_value={"authenticated": False}), \
                patch("backend.services.kubernetes_service.subprocess.Popen") as popen:
            with self.assertRaises(KubernetesReadError) as error:
                start_pod_terminal("prod", self.backend_namespace, "api-0", "api")

        self.assertEqual(error.exception.status_code, 401)
        popen.assert_not_called()

    def test_namespace_and_log_inputs_fail_closed(self):
        with self.assertRaises(KubernetesReadError):
            list_pods("prod", "kube-system")
        with self.assertRaises(KubernetesReadError):
            get_pod_logs("prod", self.backend_namespace, "api;delete-all")
        with self.assertRaises(KubernetesReadError):
            get_pod_logs("prod", self.backend_namespace, "api-0", since="7d")

    def test_invalid_environment_and_cluster_fail_closed(self):
        with self.assertRaises(KubernetesReadError):
            credential_status("staging")
        with self.assertRaises(KubernetesReadError):
            list_pods("staging", "all")


if __name__ == "__main__":
    unittest.main()