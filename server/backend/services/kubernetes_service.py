"""Read-only EKS access for the local Kubernetes operations view."""

import json
import os
import re
import subprocess
import tempfile
import time
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone


AWS_REGION = "eu-west-1"
COMMAND_TIMEOUT_SECONDS = 30
AWS_PROFILE = "EKS-ReadOnly-067615905898"
NAMESPACE_CLUSTERS = {
    "tme-ns-ev-backend-prd": "ev-backend-eks-prod",
    "tme-ns-ev-virtual-gateway-prd": "ev-virtual-gateway-eks-prod",
}
NAMESPACE_SELECTIONS = {"all", *NAMESPACE_CLUSTERS}
LOG_WINDOWS = {"15m", "1h", "6h", "24h"}
INFRASTRUCTURE_CACHE_SECONDS = 300
_INFRASTRUCTURE_CACHE = {}


class KubernetesReadError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


def _normalize_env(env):
    normalized = str(env or "").strip().lower()
    if normalized not in {"", "prod"}:
        raise KubernetesReadError(400, "Kubernetes access is limited to the production namespaces.")
    return "prod"


def _run_command(command, timeout=COMMAND_TIMEOUT_SECONDS, env=None):
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=env,
        )
    except FileNotFoundError as exc:
        raise KubernetesReadError(503, f"{command[0]} CLI is not installed or is not on PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise KubernetesReadError(504, f"{command[0]} command timed out.") from exc
    return result


def credential_status(env):
    _normalize_env(env)
    try:
        result = _run_command(
            ["aws", "sts", "get-caller-identity", "--profile", AWS_PROFILE, "--output", "json"],
            timeout=15,
        )
    except KubernetesReadError as exc:
        if exc.status_code == 503:
            return {"env": "prod", "authenticated": False, "status": "cli-missing", "message": str(exc)}
        raise

    if result.returncode != 0:
        return {"env": "prod", "authenticated": False, "status": "login-required"}

    try:
        identity = json.loads(result.stdout)
    except (TypeError, json.JSONDecodeError):
        return {"env": "prod", "authenticated": False, "status": "identity-error"}
    return {
        "env": "prod",
        "authenticated": bool(identity.get("Account")),
        "status": "ready" if identity.get("Account") else "identity-error",
        "account": identity.get("Account", ""),
        "principal": identity.get("Arn", "").rsplit("/", 1)[-1],
    }


def start_sso_login(env):
    _normalize_env(env)
    try:
        process = subprocess.Popen(
            ["aws", "sso", "login", "--profile", AWS_PROFILE],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=os.name != "nt",
        )
    except FileNotFoundError as exc:
        raise KubernetesReadError(503, "AWS CLI is not installed or is not on PATH.") from exc
    return {"env": "prod", "started": process.poll() is None}


def _pod_age(timestamp):
    if not timestamp:
        return "-"
    try:
        created = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        seconds = max(0, int((datetime.now(timezone.utc) - created).total_seconds()))
    except (TypeError, ValueError):
        return "-"
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    if seconds < 86400:
        return f"{seconds // 3600}h"
    return f"{seconds // 86400}d"


def _normalize_pod(pod, workload=""):
    metadata = pod.get("metadata") or {}
    status = pod.get("status") or {}
    spec = pod.get("spec") or {}
    container_statuses = status.get("containerStatuses") or []
    init_statuses = status.get("initContainerStatuses") or []
    container_status_by_name = {container.get("name"): container for container in container_statuses + init_statuses}
    container_specs = (spec.get("containers") or []) + (spec.get("initContainers") or [])
    conditions = status.get("conditions", [])
    ready_condition = next((item for item in conditions if item.get("type") == "Ready"), None)
    desired = len(spec.get("containers") or [])
    ready = sum(1 for container in container_statuses if container.get("ready"))
    phase = status.get("phase", "Unknown")
    if phase == "Succeeded":
        health = "Completed"
    elif phase == "Failed":
        health = "Failed"
    elif phase == "Running" and desired and ready == desired and (ready_condition is None or ready_condition.get("status") == "True"):
        health = "Healthy"
    elif phase == "Running":
        health = "Not ready"
    else:
        health = phase
    return {
        "namespace": metadata.get("namespace", "default"),
        "name": metadata.get("name", ""),
        "phase": phase,
        "health": health,
        "reason": status.get("reason", ""),
        "message": (status.get("message", "") or "")[:240],
        "ready": f"{ready}/{desired}",
        "restarts": sum(int(container.get("restartCount", 0) or 0) for container in container_statuses + init_statuses),
        "node": spec.get("nodeName", "-"),
        "scheduler": spec.get("schedulerName", "default-scheduler"),
        "scheduled": next((item.get("status") == "True" for item in status.get("conditions", []) if item.get("type") == "PodScheduled"), False),
        "age": _pod_age(metadata.get("creationTimestamp")),
        "createdAt": metadata.get("creationTimestamp", ""),
        "startTime": status.get("startTime", ""),
        "podIP": status.get("podIP", ""),
        "hostIP": status.get("hostIP", ""),
        "qosClass": status.get("qosClass", ""),
        "serviceAccount": spec.get("serviceAccountName", "default"),
        "workload": workload,
        "owners": ([{"kind": "Deployment", "name": workload}] if workload else [
            {"kind": owner.get("kind", ""), "name": owner.get("name", "")}
            for owner in metadata.get("ownerReferences", [])
        ]),
        "labels": [
            {"key": key, "value": value}
            for key, value in sorted((metadata.get("labels") or {}).items())[:12]
        ],
        "containers": [
            _normalize_container(container, container_status_by_name.get(container.get("name"), {}), kind)
            for kind, specifications in (("container", spec.get("containers") or []), ("init", spec.get("initContainers") or []))
            for container in specifications
        ],
        "conditions": [
            {
                "type": condition.get("type", ""),
                "status": condition.get("status", ""),
                "reason": condition.get("reason", ""),
                "message": (condition.get("message", "") or "")[:240],
                "lastTransitionTime": condition.get("lastTransitionTime", ""),
            }
            for condition in conditions
        ],
    }


def _normalize_deployment(deployment):
    metadata = deployment.get("metadata") or {}
    spec = deployment.get("spec") or {}
    status = deployment.get("status") or {}
    name = metadata.get("name", "")
    labels = metadata.get("labels") or {}
    selector = (spec.get("selector") or {}).get("matchLabels") or {}
    application = selector.get("app", "")
    module_suffixes = (("-sp-ws", "SP-WS"), ("-api", "API"), ("-sp", "SP"), ("-app", "App"))
    module = next((label for suffix, label in module_suffixes if application.endswith(suffix)), "Workload")
    service_slug = re.sub(r"^tme-deploy-[^-]+-tme-ev-", "", name)
    if service_slug.startswith("vgw-"):
        service_slug = service_slug.removeprefix("vgw-")
        service_name = "Virtual Gateway " + service_slug
    else:
        service_name = service_slug
    service_name = re.sub(r"-(?:sp-ws|api|sp|app)$", "", service_name)
    service_name = service_name.replace("-mgmt", "-management")
    display_words = {
        "ocpi": "OCPI", "ocpp16": "OCPP16", "mno": "MNO", "sse": "SSE",
        "iot": "IoT", "fw": "Firewall",
    }
    display_name = " ".join(display_words.get(word, word.title()) for word in service_name.split("-") if word)
    relevant_labels = {
        key: labels[key]
        for key in ("github-repository", "app.kubernetes.io/name", "app.kubernetes.io/component", "environment", "type")
        if key in labels
    }
    return {
        "name": name,
        "serviceKey": labels.get("github-repository") or service_name,
        "serviceName": display_name,
        "module": module,
        "labels": relevant_labels,
        "selector": selector,
        "desiredReplicas": int(spec.get("replicas", 1) or 0),
        "readyReplicas": int(status.get("readyReplicas", 0) or 0),
        "availableReplicas": int(status.get("availableReplicas", 0) or 0),
        "updatedReplicas": int(status.get("updatedReplicas", 0) or 0),
        "conditions": [
            {"type": item.get("type", ""), "status": item.get("status", ""), "reason": item.get("reason", ""), "message": (item.get("message", "") or "")[:180]}
            for item in status.get("conditions", [])
        ],
    }


def _normalize_node(node):
    metadata = node.get("metadata") or {}
    spec = node.get("spec") or {}
    status = node.get("status") or {}
    labels = metadata.get("labels") or {}
    provider_id = spec.get("providerID", "")
    conditions = status.get("conditions") or []
    ready = next((item for item in conditions if item.get("type") == "Ready"), None)
    return {
        "name": metadata.get("name", ""),
        "ready": ready.get("status") == "True" if ready else None,
        "conditions": [
            {"type": item.get("type", ""), "status": item.get("status", ""), "reason": item.get("reason", ""), "message": (item.get("message", "") or "")[:180]}
            for item in conditions
        ],
        "instanceId": provider_id.rsplit("/", 1)[-1] if provider_id else "",
        "zone": labels.get("topology.kubernetes.io/zone", ""),
        "instanceType": labels.get("node.kubernetes.io/instance-type", ""),
        "unschedulable": bool(spec.get("unschedulable", False)),
    }


def _aws_json(arguments, timeout=15):
    try:
        result = _run_command([
            "aws", *arguments, "--region", AWS_REGION, "--profile", AWS_PROFILE, "--output", "json",
        ], timeout=timeout)
    except KubernetesReadError:
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except (TypeError, json.JSONDecodeError):
        return None


def _enrich_nodes_with_aws(nodes):
    instance_ids = sorted({node["instanceId"] for node in nodes if re.fullmatch(r"i-[0-9a-f]+", node["instanceId"])})
    if not instance_ids:
        for node in nodes:
            node["aws"] = {"available": False, "availability": {}}
        return

    common_ids = ["--instance-ids", *instance_ids]
    instances = _aws_json([
        "ec2", "describe-instances", *common_ids, "--query",
        "Reservations[].Instances[].[InstanceId,State.Name,Placement.AvailabilityZone,InstanceType]",
    ])
    instance_by_id = {
        row[0]: {"state": row[1], "zone": row[2], "instanceType": row[3]}
        for row in (instances or []) if isinstance(row, list) and len(row) >= 4
    }
    statuses = _aws_json([
        "ec2", "describe-instance-status", "--include-all-instances", *common_ids, "--query",
        "InstanceStatuses[].{InstanceId:InstanceId,SystemStatus:SystemStatus.Status,InstanceStatus:InstanceStatus.Status,Events:Events[].{Code:Code,Description:Description,NotBefore:NotBefore,NotAfter:NotAfter}}",
    ])
    status_by_id = {item.get("InstanceId"): item for item in (statuses or [])}

    end = datetime.now(timezone.utc)
    queries = []
    query_instance_ids = {}
    for index, instance_id in enumerate(instance_ids):
        query_id = f"cpu{index}"
        query_instance_ids[query_id] = instance_id
        queries.append({
            "Id": query_id,
            "MetricStat": {
                "Metric": {
                    "Namespace": "AWS/EC2",
                    "MetricName": "CPUUtilization",
                    "Dimensions": [{"Name": "InstanceId", "Value": instance_id}],
                },
                "Period": 300,
                "Stat": "Average",
            },
            "ReturnData": True,
        })
    cpu_payload = _aws_json([
        "cloudwatch", "get-metric-data", "--start-time", (end - timedelta(hours=24)).isoformat(),
        "--end-time", end.isoformat(), "--metric-data-queries", json.dumps(queries),
        "--scan-by", "TimestampAscending",
    ], timeout=20) if queries else None
    cpu_by_id = {}
    if cpu_payload is not None:
        for result in cpu_payload.get("MetricDataResults", []):
            instance_id = query_instance_ids.get(result.get("Id"))
            if not instance_id:
                continue
            cpu_by_id[instance_id] = [
                {"timestamp": timestamp, "value": value}
                for timestamp, value in zip(result.get("Timestamps") or [], result.get("Values") or [])
            ]

    def read_alarms(instance_id):
        return _aws_json([
            "cloudwatch", "describe-alarms-for-metric", "--namespace", "AWS/EC2",
            "--metric-name", "CPUUtilization", "--dimensions", f"Name=InstanceId,Value={instance_id}",
            "--query", "MetricAlarms[].{name:AlarmName,state:StateValue,reason:StateReason}",
        ])

    with ThreadPoolExecutor(max_workers=min(8, len(instance_ids))) as executor:
        alarm_results = list(executor.map(read_alarms, instance_ids))
    alarms_by_id = dict(zip(instance_ids, alarm_results))
    for node in nodes:
        instance_id = node.get("instanceId", "")
        instance = instance_by_id.get(instance_id)
        status = status_by_id.get(instance_id)
        alarms = alarms_by_id.get(instance_id)
        node["aws"] = {
            "available": instance is not None or status is not None,
            "state": instance.get("state", "") if instance else "",
            "zone": instance.get("zone", "") if instance else node.get("zone", ""),
            "instanceType": instance.get("instanceType", "") if instance else node.get("instanceType", ""),
            "systemStatus": status.get("SystemStatus", "") if status else "",
            "instanceStatus": status.get("InstanceStatus", "") if status else "",
            "events": [
                {"code": item.get("Code", ""), "description": item.get("Description", ""), "notBefore": item.get("NotBefore", ""), "notAfter": item.get("NotAfter", "")}
                for item in (status or {}).get("Events") or []
            ],
            "cpuAvailable": cpu_payload is not None,
            "cpu": cpu_by_id.get(instance_id, []),
            "alarmsAvailable": alarms is not None,
            "alarms": alarms or [],
        }


def _normalize_container(container, container_status, kind):
    state = container_status.get("state") or {}
    state_name = next(iter(state), "unknown")
    state_details = state.get(state_name) or {}
    last_state = container_status.get("lastState") or {}
    last_state_name = next(iter(last_state), "")
    last_state_details = last_state.get(last_state_name) or {}
    resources = container.get("resources") or {}
    probes = {}
    for probe_name in ("readinessProbe", "livenessProbe", "startupProbe"):
        probe = container.get(probe_name)
        if probe:
            probes[probe_name.removesuffix("Probe")] = {
                "initialDelaySeconds": probe.get("initialDelaySeconds", 0),
                "periodSeconds": probe.get("periodSeconds", 0),
                "failureThreshold": probe.get("failureThreshold", 0),
                "timeoutSeconds": probe.get("timeoutSeconds", 0),
            }
    return {
        "name": container.get("name", ""),
        "kind": kind,
        "image": container.get("image", ""),
        "ready": bool(container_status.get("ready")),
        "restarts": int(container_status.get("restartCount", 0) or 0),
        "state": state_name,
        "reason": state_details.get("reason", ""),
        "message": (state_details.get("message", "") or "")[:180],
        "startedAt": state_details.get("startedAt", ""),
        "exitCode": state_details.get("exitCode"),
        "lastState": last_state_name,
        "lastReason": last_state_details.get("reason", ""),
        "lastMessage": (last_state_details.get("message", "") or "")[:180],
        "lastStartedAt": last_state_details.get("startedAt", ""),
        "lastFinishedAt": last_state_details.get("finishedAt", ""),
        "lastExitCode": last_state_details.get("exitCode"),
        "requests": resources.get("requests") or {},
        "limits": resources.get("limits") or {},
        "probes": probes,
    }


def _normalize_event(event):
    metadata = event.get("metadata") or {}
    involved_object = event.get("involvedObject") or event.get("regarding") or {}
    series = event.get("series") or {}
    return {
        "namespace": metadata.get("namespace", "default"),
        "type": event.get("type", "Normal"),
        "reason": event.get("reason", "Event"),
        "message": (event.get("message", "") or "")[:320],
        "count": int(event.get("count", series.get("count", 1)) or 1),
        "timestamp": (
            event.get("eventTime")
            or series.get("lastObservedTime")
            or event.get("lastTimestamp")
            or metadata.get("creationTimestamp", "")
        ),
        "objectKind": involved_object.get("kind", ""),
        "objectName": involved_object.get("name", ""),
        "objectNamespace": involved_object.get("namespace", metadata.get("namespace", "")),
        "reportingComponent": (event.get("reportingComponent") or (event.get("source") or {}).get("component", "")),
        "action": event.get("action", ""),
    }


def _read_metrics(kubeconfig, namespace):
    try:
        response = _run_command([
            "kubectl", "top", "pods", "--containers", "--no-headers", "--namespace", namespace,
            "--kubeconfig", kubeconfig, "--request-timeout=8s",
        ], timeout=10)
    except KubernetesReadError:
        return [], False, "Metrics API is unavailable for this namespace."
    if response.returncode != 0:
        message = response.stderr.strip()
        if "forbidden" in message.lower():
            return [], False, "Metrics access is denied for this namespace."
        return [], False, "Metrics API is unavailable for this namespace."
    metrics = []
    for line in response.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 4:
            metrics.append({"namespace": namespace, "pod": fields[0], "container": fields[1], "cpu": fields[2], "memory": fields[3]})
    return metrics, True, ""


def _read_namespace(env, namespace):
    cluster_name = NAMESPACE_CLUSTERS[namespace]
    try:
        with tempfile.TemporaryDirectory(prefix="charger-dashboard-eks-") as temp_dir:
            kubeconfig = os.path.join(temp_dir, "config")
            update = _run_command([
                "aws", "eks", "update-kubeconfig", "--region", AWS_REGION, "--name", cluster_name,
                "--profile", AWS_PROFILE, "--kubeconfig", kubeconfig,
            ])
            if update.returncode != 0:
                return {
                    "namespace": namespace, "cluster": cluster_name, "pods": [], "deployments": [], "nodes": [], "events": [], "metrics": [],
                    "availability": {"pods": False, "deployments": False, "replicaSets": False, "nodes": False, "events": False, "metrics": False},
                    "errors": {"pods": "Unable to connect to the EKS cluster."},
                }

            def read_json(resource, timeout=10):
                try:
                    result = _run_command([
                        "kubectl", "get", resource, "--namespace", namespace, "--output=json", "--kubeconfig", kubeconfig,
                        "--request-timeout=8s",
                    ], timeout=timeout)
                except KubernetesReadError as exc:
                    return None, str(exc)
                if result.returncode != 0:
                    return None, result.stderr.strip()
                try:
                    return json.loads(result.stdout), ""
                except (TypeError, json.JSONDecodeError):
                    return None, "Kubernetes returned an invalid response."

            with ThreadPoolExecutor(max_workers=3) as executor:
                pods_future = executor.submit(read_json, "pods", 12)
                events_future = executor.submit(read_json, "events")
                metrics_future = executor.submit(_read_metrics, kubeconfig, namespace)
                pods_payload, pods_error = pods_future.result()
                events_payload, events_error = events_future.result()
                metrics, metrics_available, metrics_error = metrics_future.result()
            deployments_payload, deployments_error = read_json("deployments")
            replicasets_payload, replicasets_error = read_json("replicasets")

            deployments = [_normalize_deployment(item) for item in (deployments_payload or {}).get("items", [])]
            deployment_names = {item["name"] for item in deployments}
            replica_set_owners = {}
            for replica_set in (replicasets_payload or {}).get("items", []):
                metadata = replica_set.get("metadata") or {}
                deployment_owner = next((
                    owner.get("name", "") for owner in metadata.get("ownerReferences", [])
                    if owner.get("kind") == "Deployment" and owner.get("name") in deployment_names
                ), "")
                if deployment_owner:
                    replica_set_owners[metadata.get("name", "")] = deployment_owner

            pod_items = (pods_payload or {}).get("items", [])
            node_names = sorted({
                (pod.get("spec") or {}).get("nodeName")
                for pod in pod_items
                if (pod.get("spec") or {}).get("nodeName")
            })
            nodes = []
            nodes_available = True
            if pods_payload is None:
                nodes_available = False
            elif node_names:
                try:
                    result = _run_command([
                        "kubectl", "get", "nodes", *node_names, "--output=json", "--kubeconfig", kubeconfig,
                        "--request-timeout=8s",
                    ], timeout=10)
                    if result.returncode == 0:
                        node_payload = json.loads(result.stdout)
                        node_items = node_payload.get("items", []) if node_payload.get("kind") == "List" else [node_payload]
                        nodes = [_normalize_node(node) for node in node_items]
                except (KubernetesReadError, TypeError, json.JSONDecodeError):
                    nodes = []
                nodes_available = len(nodes) == len(node_names)
        if pods_payload is None:
            errors = {"pods": "Pod access is denied for this namespace." if "forbidden" in pods_error.lower() else "Unable to read pods from this namespace."}
        else:
            errors = {}
        if not metrics_available:
            errors["metrics"] = metrics_error
        if deployments_payload is None:
            errors["deployments"] = "Deployment access is unavailable in this namespace."
        if replicasets_payload is None:
            errors["replicaSets"] = "ReplicaSet access is unavailable in this namespace."
        if not nodes_available:
            errors["nodes"] = "Some nodes hosting this namespace's pods are unavailable."
        return {
            "namespace": namespace,
            "cluster": cluster_name,
            "pods": [
                _normalize_pod(
                    pod,
                    replica_set_owners.get(next((owner.get("name", "") for owner in (pod.get("metadata") or {}).get("ownerReferences", []) if owner.get("kind") == "ReplicaSet"), ""), ""),
                )
                for pod in pod_items
            ],
            "deployments": deployments,
            "nodes": nodes,
            "events": [_normalize_event(event) for event in (events_payload or {}).get("items", [])],
            "metrics": metrics,
            "availability": {
                "pods": pods_payload is not None,
                "deployments": deployments_payload is not None,
                "replicaSets": replicasets_payload is not None,
                "nodes": nodes_available,
                "events": events_payload is not None,
                "metrics": metrics_available,
            },
            "errors": errors,
        }
    except KubernetesReadError as exc:
        return {
            "namespace": namespace, "cluster": cluster_name, "pods": [], "deployments": [], "nodes": [], "events": [], "metrics": [],
            "availability": {"pods": False, "deployments": False, "replicaSets": False, "nodes": False, "events": False, "metrics": False},
            "errors": {"pods": str(exc)},
        }


def _deduplicate_events(events):
    unique = {}
    for event in events:
        key = (event["namespace"], event["objectKind"], event["objectName"], event["type"], event["reason"], event["message"])
        existing = unique.get(key)
        if existing is None:
            unique[key] = event
            continue
        existing["count"] = max(existing["count"], event["count"])
        if event["timestamp"] > existing["timestamp"]:
            unique[key] = {**event, "count": max(existing["count"], event["count"])}
    return sorted(unique.values(), key=lambda event: event["timestamp"], reverse=True)[:80]


def list_pods(env, namespace="all"):
    _normalize_env(env)
    if namespace not in NAMESPACE_SELECTIONS:
        raise KubernetesReadError(400, "Unsupported Kubernetes namespace selection.")

    credentials = credential_status("prod")
    if not credentials["authenticated"]:
        raise KubernetesReadError(401, "AWS SSO login is required for the production read-only profile.")

    namespaces = list(NAMESPACE_CLUSTERS) if namespace == "all" else [namespace]
    with ThreadPoolExecutor(max_workers=len(namespaces)) as executor:
        snapshots = list(executor.map(lambda item: _read_namespace("prod", item), namespaces))
    pods = [pod for snapshot in snapshots for pod in snapshot["pods"]]
    deployments = [deployment | {"namespace": snapshot["namespace"]} for snapshot in snapshots for deployment in snapshot.get("deployments", [])]
    nodes = [node | {"namespace": snapshot["namespace"], "cluster": snapshot["cluster"]} for snapshot in snapshots for node in snapshot.get("nodes", [])]
    events = _deduplicate_events([event for snapshot in snapshots for event in snapshot["events"]])
    metrics = [metric for snapshot in snapshots for metric in snapshot["metrics"]]
    summary = {
        "total": len(pods),
        "healthy": sum(pod["health"] == "Healthy" for pod in pods),
        "notReady": sum(pod["health"] == "Not ready" for pod in pods),
        "pending": sum(pod["phase"] == "Pending" for pod in pods),
        "failed": sum(pod["health"] == "Failed" for pod in pods),
        "restarts": sum(pod["restarts"] for pod in pods),
        "warningEvents": sum(event["type"] == "Warning" for event in events),
    }
    return {
        "env": "prod",
        "namespace": namespace,
        "namespaces": snapshots,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "pods": pods,
        "deployments": deployments,
        "nodes": nodes,
        "events": events,
        "eventsAvailable": all(snapshot["availability"]["events"] for snapshot in snapshots),
        "metrics": metrics,
        "metricsAvailable": {snapshot["namespace"]: snapshot["availability"]["metrics"] for snapshot in snapshots},
    }


def _read_namespace_infrastructure(namespace):
    cluster_name = NAMESPACE_CLUSTERS[namespace]
    with tempfile.TemporaryDirectory(prefix="charger-dashboard-eks-") as temp_dir:
        kubeconfig = os.path.join(temp_dir, "config")
        update = _run_command([
            "aws", "eks", "update-kubeconfig", "--region", AWS_REGION, "--name", cluster_name,
            "--profile", AWS_PROFILE, "--kubeconfig", kubeconfig,
        ])
        if update.returncode != 0:
            return {"namespace": namespace, "cluster": cluster_name, "nodes": [], "availability": {"nodes": False, "ec2": False, "cloudWatchCpu": False, "alarms": False}, "errors": {"nodes": "Unable to connect to the EKS cluster."}}

        pods = _run_command([
            "kubectl", "get", "pods", "--namespace", namespace, "--output=json", "--kubeconfig", kubeconfig,
            "--request-timeout=8s",
        ], timeout=12)
        if pods.returncode != 0:
            return {"namespace": namespace, "cluster": cluster_name, "nodes": [], "availability": {"nodes": False, "ec2": False, "cloudWatchCpu": False, "alarms": False}, "errors": {"nodes": "Unable to resolve namespace pod placement for infrastructure context."}}
        try:
            pod_items = json.loads(pods.stdout).get("items", [])
        except (TypeError, json.JSONDecodeError):
            return {"namespace": namespace, "cluster": cluster_name, "nodes": [], "availability": {"nodes": False, "ec2": False, "cloudWatchCpu": False, "alarms": False}, "errors": {"nodes": "Kubernetes returned an invalid placement response."}}
        node_names = sorted({(pod.get("spec") or {}).get("nodeName") for pod in pod_items if (pod.get("spec") or {}).get("nodeName")})
        nodes = []
        nodes_available = True
        if node_names:
            try:
                result = _run_command([
                    "kubectl", "get", "nodes", *node_names, "--output=json", "--kubeconfig", kubeconfig,
                    "--request-timeout=8s",
                ], timeout=10)
                if result.returncode == 0:
                    payload = json.loads(result.stdout)
                    items = payload.get("items", []) if payload.get("kind") == "List" else [payload]
                    nodes = [_normalize_node(node) for node in items]
                else:
                    nodes_available = False
            except (KubernetesReadError, TypeError, json.JSONDecodeError):
                nodes_available = False
            nodes_available = nodes_available and len(nodes) == len(node_names)
        if nodes:
            try:
                _enrich_nodes_with_aws(nodes)
            except (KubernetesReadError, TypeError, ValueError):
                for node in nodes:
                    node["aws"] = {"available": False, "cpuAvailable": False, "alarmsAvailable": False, "events": [], "cpu": [], "alarms": []}

    ec2_available = bool(nodes) and all(node.get("aws", {}).get("available") for node in nodes)
    cpu_available = bool(nodes) and all(node.get("aws", {}).get("cpuAvailable") for node in nodes)
    alarms_available = bool(nodes) and all(node.get("aws", {}).get("alarmsAvailable") for node in nodes)
    errors = {}
    if not nodes_available:
        errors["nodes"] = "Kubernetes node details are unavailable for some pods in this namespace."
    if nodes and not ec2_available:
        errors["ec2"] = "EC2 instance details are unavailable for some hosting nodes."
    if nodes and not cpu_available:
        errors["cloudWatchCpu"] = "CloudWatch CPU history is unavailable for some hosting nodes."
    if nodes and not alarms_available:
        errors["alarms"] = "CloudWatch alarm access is unavailable for some hosting nodes."
    return {
        "namespace": namespace,
        "cluster": cluster_name,
        "nodes": nodes,
        "availability": {"nodes": nodes_available, "ec2": ec2_available, "cloudWatchCpu": cpu_available, "alarms": alarms_available},
        "errors": errors,
    }


def get_node_infrastructure(env, namespace="all", force=False):
    _normalize_env(env)
    if namespace not in NAMESPACE_SELECTIONS:
        raise KubernetesReadError(400, "Unsupported Kubernetes namespace selection.")
    if not credential_status("prod")["authenticated"]:
        raise KubernetesReadError(401, "AWS SSO login is required for the production read-only profile.")

    namespaces = list(NAMESPACE_CLUSTERS) if namespace == "all" else [namespace]
    now = time.monotonic()
    snapshots_by_namespace = {}
    uncached = []
    for item in namespaces:
        cached = _INFRASTRUCTURE_CACHE.get(item)
        if not force and cached and now - cached[0] < INFRASTRUCTURE_CACHE_SECONDS:
            snapshots_by_namespace[item] = deepcopy(cached[1])
        else:
            uncached.append(item)

    def read_infrastructure(item):
        try:
            return _read_namespace_infrastructure(item)
        except KubernetesReadError:
            return {"namespace": item, "cluster": NAMESPACE_CLUSTERS[item], "nodes": [], "availability": {"nodes": False, "ec2": False, "cloudWatchCpu": False, "alarms": False}, "errors": {"nodes": "Optional infrastructure context is unavailable."}}

    if uncached:
        with ThreadPoolExecutor(max_workers=len(uncached)) as executor:
            fresh_snapshots = list(executor.map(read_infrastructure, uncached))
        for item, snapshot in zip(uncached, fresh_snapshots):
            _INFRASTRUCTURE_CACHE[item] = (now, snapshot)
            snapshots_by_namespace[item] = snapshot
    snapshots = [snapshots_by_namespace[item] for item in namespaces]
    nodes = [node | {"namespace": snapshot["namespace"], "cluster": snapshot["cluster"]} for snapshot in snapshots for node in snapshot["nodes"]]
    return {
        "env": "prod",
        "namespace": namespace,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "namespaces": snapshots,
        "nodes": nodes,
    }


def get_pod_logs(env, namespace, pod, container="", previous=False, since="1h"):
    _normalize_env(env)
    if namespace not in NAMESPACE_CLUSTERS:
        raise KubernetesReadError(400, "Unsupported Kubernetes namespace.")
    if not isinstance(pod, str) or len(pod) > 253 or not re.fullmatch(r"[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?", pod):
        raise KubernetesReadError(400, "Invalid pod name.")
    if container and (len(container) > 63 or not re.fullmatch(r"[a-z0-9](?:[-a-z0-9]*[a-z0-9])?", container)):
        raise KubernetesReadError(400, "Invalid container name.")
    if since not in LOG_WINDOWS:
        raise KubernetesReadError(400, "Unsupported log time window.")
    if not credential_status("prod")["authenticated"]:
        raise KubernetesReadError(401, "AWS SSO login is required for the production read-only profile.")

    with tempfile.TemporaryDirectory(prefix="charger-dashboard-eks-") as temp_dir:
        kubeconfig = os.path.join(temp_dir, "config")
        cluster_name = NAMESPACE_CLUSTERS[namespace]
        update = _run_command([
            "aws", "eks", "update-kubeconfig", "--region", AWS_REGION, "--name", cluster_name,
            "--profile", AWS_PROFILE, "--kubeconfig", kubeconfig,
        ])
        if update.returncode != 0:
            raise KubernetesReadError(502, "Unable to connect to the selected EKS cluster.")
        command = [
            "kubectl", "logs", pod, "--namespace", namespace, "--timestamps=true", "--since", since,
            "--tail=250", "--limit-bytes=65536", "--kubeconfig", kubeconfig, "--request-timeout=10s",
        ]
        if container:
            command.extend(["--container", container])
        else:
            command.append("--all-containers=true")
            command.append("--prefix=true")
        if previous:
            command.append("--previous=true")
        result = _run_command(command, timeout=12)
        if result.returncode != 0:
            message = result.stderr.strip()
            if "forbidden" in message.lower():
                raise KubernetesReadError(403, "Log access is denied for this container.")
            raise KubernetesReadError(404, message[:300] or "Logs are unavailable for this container.")
        return {
            "namespace": namespace,
            "pod": pod,
            "container": container or "all",
            "previous": bool(previous),
            "since": since,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "logs": result.stdout[-65536:],
            "truncated": len(result.stdout) >= 65536,
        }